import { prisma } from "./db.js";
import { config } from "./config.js";

export function formatUsdtMicro(micro: number): string {
  const neg = micro < 0;
  const n = Math.abs(micro);
  const whole = Math.floor(n / 1_000_000);
  const frac = String(n % 1_000_000).padStart(6, "0");
  return `${neg ? "-" : ""}${whole}.${frac}`;
}

export function parseUsdtToMicro(value: string | number): number {
  if (typeof value === "number") {
    return Math.round(value * 1_000_000);
  }
  const cleaned = value.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(cleaned)) {
    throw new Error("Invalid USDT amount");
  }
  const [w, f = ""] = cleaned.split(".");
  return Number(w) * 1_000_000 + Number((f + "000000").slice(0, 6));
}

/** Base micro from chips, truncated to leave 4 decimal digits for uniqueness. */
export function chipsToBaseUsdtMicro(amountChips: number): number {
  const rate = Math.max(1, config.chipsPerUsdt);
  const exact = (amountChips / rate) * 1_000_000;
  return Math.max(1_000_000, Math.floor(exact / 10_000) * 10_000);
}

export async function allocateUniqueUsdtMicro(
  amountChips: number,
): Promise<number> {
  const base = chipsToBaseUsdtMicro(amountChips);
  const now = new Date();
  for (let salt = 1; salt <= 9999; salt++) {
    const candidate = base + salt;
    const clash = await prisma.depositIntent.findFirst({
      where: {
        status: "pending",
        amountUsdtMicro: candidate,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      select: { id: true },
    });
    if (!clash) return candidate;
  }
  throw new Error("Could not allocate unique USDT amount — try again");
}

export async function confirmDepositIntent(
  intentId: string,
  opts: { txid?: string | null; confirmedBy: "auto" | "admin" },
) {
  return prisma.$transaction(async (tx) => {
    const intent = await tx.depositIntent.findUnique({ where: { id: intentId } });
    if (!intent) throw new Error("Intent not found");
    if (intent.status !== "pending") throw new Error("Already processed");

    if (opts.txid) {
      const used = await tx.depositIntent.findFirst({
        where: { txid: opts.txid, NOT: { id: intentId } },
      });
      if (used) throw new Error("Txid already used");
    }

    await tx.depositIntent.update({
      where: { id: intentId },
      data: {
        status: "confirmed",
        txid: opts.txid ?? intent.txid,
        confirmedBy: opts.confirmedBy,
      },
    });
    await tx.user.update({
      where: { id: intent.userId },
      data: { balance: { increment: intent.amountChips } },
    });
    await tx.ledgerEntry.create({
      data: {
        userId: intent.userId,
        kind: "deposit",
        amount: intent.amountChips,
        meta: JSON.stringify({
          intentId,
          asset: intent.asset,
          network: intent.network,
          amountUsdt: intent.amountUsdtMicro
            ? formatUsdtMicro(intent.amountUsdtMicro)
            : null,
          txid: opts.txid ?? intent.txid,
          confirmedBy: opts.confirmedBy,
        }),
      },
    });
    return intent;
  });
}

export async function expireStaleDeposits(): Promise<number> {
  const now = new Date();
  const r = await prisma.depositIntent.updateMany({
    where: {
      status: "pending",
      expiresAt: { lte: now },
    },
    data: { status: "expired" },
  });
  return r.count;
}
