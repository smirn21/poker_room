import { prisma } from "./db.js";
import {
  confirmDepositIntent,
  expireStaleDeposits,
  formatUsdtMicro,
} from "./depositService.js";

export type IncomingUsdtTx = {
  txid: string;
  amountUsdtMicro: number;
  fromAddress?: string | null;
  toAddress?: string | null;
};

type Log = {
  info?: (o: unknown, msg?: string) => void;
  warn?: (o: unknown, msg?: string) => void;
};

/**
 * Match one incoming USDT transfer to a pending deposit intent (unique micro amount).
 * Idempotent on txid.
 */
export async function applyIncomingUsdtTransfer(
  tx: IncomingUsdtTx,
  log?: Log,
): Promise<"matched" | "unmatched" | "duplicate" | "skipped"> {
  if (!tx.txid || !Number.isFinite(tx.amountUsdtMicro) || tx.amountUsdtMicro <= 0) {
    return "skipped";
  }

  const already = await prisma.depositIntent.findFirst({
    where: { txid: tx.txid },
    select: { id: true },
  });
  if (already) return "duplicate";

  const knownUnmatched = await prisma.unmatchedDeposit.findUnique({
    where: { txid: tx.txid },
  });
  if (knownUnmatched) return "duplicate";

  const intent = await prisma.depositIntent.findFirst({
    where: {
      status: "pending",
      asset: "USDT",
      network: "TRC20",
      amountUsdtMicro: tx.amountUsdtMicro,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    orderBy: { createdAt: "asc" },
  });

  if (intent) {
    try {
      await confirmDepositIntent(intent.id, {
        txid: tx.txid,
        confirmedBy: "auto",
      });
      log?.info?.(
        {
          intentId: intent.id,
          txid: tx.txid,
          usdt: formatUsdtMicro(tx.amountUsdtMicro),
        },
        "deposit_auto_confirmed",
      );
      return "matched";
    } catch (e) {
      log?.warn?.(
        { err: e instanceof Error ? e.message : e, txid: tx.txid },
        "deposit_auto_confirm_failed",
      );
      throw e;
    }
  }

  await prisma.unmatchedDeposit.create({
    data: {
      txid: tx.txid,
      amountUsdtMicro: tx.amountUsdtMicro,
      fromAddress: tx.fromAddress ?? null,
      toAddress: tx.toAddress ?? null,
      note: `No pending intent for ${formatUsdtMicro(tx.amountUsdtMicro)} USDT`,
    },
  });
  return "unmatched";
}

export async function applyIncomingUsdtBatch(
  txs: IncomingUsdtTx[],
  log?: Log,
): Promise<{ matched: number; unmatched: number; expired: number }> {
  const expired = await expireStaleDeposits();
  let matched = 0;
  let unmatched = 0;
  for (const tx of txs) {
    const r = await applyIncomingUsdtTransfer(tx, log);
    if (r === "matched") matched += 1;
    if (r === "unmatched") unmatched += 1;
  }
  return { matched, unmatched, expired };
}
