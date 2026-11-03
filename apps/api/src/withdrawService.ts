import { prisma } from "./db.js";
import { config } from "./config.js";
import { formatUsdtMicro } from "./depositService.js";

/** Tron base58 address: starts with T, ~34 chars. */
const TRC20_ADDRESS_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;

export function isValidTrc20Address(address: string): boolean {
  return TRC20_ADDRESS_RE.test(address.trim());
}

/** Exact reverse of deposit rate: chips must be divisible by chipsPerUsdt. */
export function chipsToWithdrawUsdtMicro(amountChips: number): number {
  const rate = Math.max(1, config.chipsPerUsdt);
  if (amountChips < rate) {
    throw new Error(`Minimum withdrawal is ${rate} chips (1 USDT)`);
  }
  if (amountChips % rate !== 0) {
    throw new Error(`Amount must be a multiple of ${rate} chips`);
  }
  return (amountChips / rate) * 1_000_000;
}

export type WithdrawDto = {
  id: string;
  status: string;
  amountChips: number;
  amountUsdt: string;
  amountUsdtMicro: number;
  address: string;
  network: string;
  asset: string;
  createdAt: Date;
  updatedAt: Date;
};

export function toWithdrawDto(w: {
  id: string;
  status: string;
  amountChips: number;
  amountUsdtMicro: number;
  address: string;
  network: string;
  asset: string;
  createdAt: Date;
  updatedAt: Date;
}): WithdrawDto {
  return {
    id: w.id,
    status: w.status,
    amountChips: w.amountChips,
    amountUsdt: formatUsdtMicro(w.amountUsdtMicro),
    amountUsdtMicro: w.amountUsdtMicro,
    address: w.address,
    network: w.network,
    asset: w.asset,
    createdAt: w.createdAt,
    updatedAt: w.updatedAt,
  };
}

export async function createWithdrawIntent(opts: {
  userId: string;
  amountChips: number;
  address: string;
}): Promise<{
  intent: WithdrawDto;
  userBalance: number;
  userTelegramId: string;
  userName: string;
}> {
  const address = opts.address.trim();
  if (!isValidTrc20Address(address)) {
    throw new Error("Invalid TRC20 address");
  }
  const amountUsdtMicro = chipsToWithdrawUsdtMicro(opts.amountChips);

  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUniqueOrThrow({ where: { id: opts.userId } });
    if (!user.whitelisted) throw new Error("Not whitelisted");
    if (user.blockedAt) throw new Error("Account blocked");
    if (user.balance < opts.amountChips) {
      throw new Error("Insufficient balance");
    }

    const pending = await tx.withdrawIntent.findFirst({
      where: { userId: user.id, status: "pending" },
      select: { id: true },
    });
    if (pending) {
      throw new Error("You already have a pending withdrawal");
    }

    const intent = await tx.withdrawIntent.create({
      data: {
        userId: user.id,
        amountChips: opts.amountChips,
        amountUsdtMicro,
        address,
        asset: "USDT",
        network: "TRC20",
        status: "pending",
      },
    });

    const updated = await tx.user.update({
      where: { id: user.id },
      data: { balance: { decrement: opts.amountChips } },
    });

    await tx.ledgerEntry.create({
      data: {
        userId: user.id,
        kind: "withdraw",
        amount: -opts.amountChips,
        meta: JSON.stringify({
          intentId: intent.id,
          phase: "hold",
          address,
          amountUsdt: formatUsdtMicro(amountUsdtMicro),
        }),
      },
    });

    return { intent, user: updated };
  });

  return {
    intent: toWithdrawDto(result.intent),
    userBalance: result.user.balance,
    userTelegramId: result.user.telegramId,
    userName: result.user.name,
  };
}

export async function payWithdrawIntent(
  intentId: string,
  adminTelegramId: string,
): Promise<{
  intent: WithdrawDto;
  userTelegramId: string;
  userName: string;
}> {
  const result = await prisma.$transaction(async (tx) => {
    const intent = await tx.withdrawIntent.findUnique({ where: { id: intentId } });
    if (!intent) throw new Error("Withdrawal not found");
    if (intent.status === "paid") {
      const user = await tx.user.findUniqueOrThrow({ where: { id: intent.userId } });
      return { intent, user, already: true as const };
    }
    if (intent.status !== "pending") {
      throw new Error("Withdrawal already processed");
    }

    const updated = await tx.withdrawIntent.update({
      where: { id: intentId },
      data: { status: "paid", adminTelegramId },
    });

    await tx.ledgerEntry.create({
      data: {
        userId: intent.userId,
        kind: "withdraw",
        amount: 0,
        meta: JSON.stringify({
          intentId: intent.id,
          phase: "paid",
          address: intent.address,
          amountUsdt: formatUsdtMicro(intent.amountUsdtMicro),
          adminTelegramId,
        }),
      },
    });

    const user = await tx.user.findUniqueOrThrow({ where: { id: intent.userId } });
    return { intent: updated, user, already: false as const };
  });

  return {
    intent: toWithdrawDto(result.intent),
    userTelegramId: result.user.telegramId,
    userName: result.user.name,
  };
}

export async function rejectWithdrawIntent(
  intentId: string,
  adminTelegramId: string,
): Promise<{
  intent: WithdrawDto;
  userTelegramId: string;
  userName: string;
  refunded: boolean;
}> {
  const result = await prisma.$transaction(async (tx) => {
    const intent = await tx.withdrawIntent.findUnique({ where: { id: intentId } });
    if (!intent) throw new Error("Withdrawal not found");
    if (intent.status === "rejected") {
      const user = await tx.user.findUniqueOrThrow({ where: { id: intent.userId } });
      return { intent, user, refunded: false };
    }
    if (intent.status !== "pending") {
      throw new Error("Withdrawal already processed");
    }

    const updated = await tx.withdrawIntent.update({
      where: { id: intentId },
      data: { status: "rejected", adminTelegramId },
    });

    await tx.user.update({
      where: { id: intent.userId },
      data: { balance: { increment: intent.amountChips } },
    });

    await tx.ledgerEntry.create({
      data: {
        userId: intent.userId,
        kind: "withdraw_refund",
        amount: intent.amountChips,
        meta: JSON.stringify({
          intentId: intent.id,
          phase: "rejected",
          adminTelegramId,
        }),
      },
    });

    const user = await tx.user.findUniqueOrThrow({ where: { id: intent.userId } });
    return { intent: updated, user, refunded: true };
  });

  return {
    intent: toWithdrawDto(result.intent),
    userTelegramId: result.user.telegramId,
    userName: result.user.name,
    refunded: result.refunded,
  };
}
