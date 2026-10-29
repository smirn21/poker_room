import { config } from "./config.js";
import { prisma } from "./db.js";
import {
  confirmDepositIntent,
  expireStaleDeposits,
  formatUsdtMicro,
} from "./depositService.js";

type Trc20Tx = {
  transaction_id: string;
  from: string;
  to: string;
  value: string;
  block_timestamp: number;
};

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;
let lastOkAt: string | null = null;
let lastError: string | null = null;
let lastMatched = 0;

export function tronWatchStatus() {
  return {
    enabled: config.tronWatchEnabled && Boolean(config.tronUsdtAddress),
    provider: "trongrid" as const,
    address: config.tronUsdtAddress || null,
    contract: config.tronUsdtContract,
    intervalMs: config.tronWatchIntervalMs,
    lastOkAt,
    lastError,
    lastMatched,
  };
}

async function fetchIncomingUsdt(): Promise<Trc20Tx[]> {
  if (!config.tronUsdtAddress) return [];
  const url = new URL(
    `${config.trongridBase}/v1/accounts/${config.tronUsdtAddress}/transactions/trc20`,
  );
  url.searchParams.set("only_to", "true");
  url.searchParams.set("limit", "50");
  url.searchParams.set("contract_address", config.tronUsdtContract);

  const headers: Record<string, string> = { Accept: "application/json" };
  if (config.trongridApiKey) {
    headers["TRON-PRO-API-KEY"] = config.trongridApiKey;
  }

  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`TronGrid ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as {
    data?: Array<{
      transaction_id?: string;
      from?: string;
      to?: string;
      value?: string;
      block_timestamp?: number;
    }>;
  };
  return (json.data ?? [])
    .filter((row) => row.transaction_id && row.value)
    .map((row) => ({
      transaction_id: row.transaction_id!,
      from: row.from ?? "",
      to: row.to ?? "",
      value: row.value!,
      block_timestamp: Number(row.block_timestamp ?? 0),
    }));
}

export async function pollTronUsdtDeposits(log?: {
  info: (o: unknown, msg?: string) => void;
  warn: (o: unknown, msg?: string) => void;
  error: (o: unknown, msg?: string) => void;
}): Promise<{ matched: number; unmatched: number; expired: number }> {
  const expired = await expireStaleDeposits();
  if (!config.tronUsdtAddress) {
    return { matched: 0, unmatched: 0, expired };
  }

  const txs = await fetchIncomingUsdt();
  let matched = 0;
  let unmatched = 0;
  const now = Date.now();
  const lookbackMs = Math.max(config.depositTtlMinutes, 60) * 60_000 * 2;

  for (const tx of txs) {
    if (!tx.transaction_id || !tx.value) continue;
    if (tx.to && tx.to !== config.tronUsdtAddress) continue;
    if (now - (tx.block_timestamp || 0) > lookbackMs) continue;

    const already = await prisma.depositIntent.findFirst({
      where: { txid: tx.transaction_id },
      select: { id: true },
    });
    if (already) continue;

    const knownUnmatched = await prisma.unmatchedDeposit.findUnique({
      where: { txid: tx.transaction_id },
    });
    if (knownUnmatched) continue;

    let micro = 0;
    try {
      micro = Number(tx.value);
    } catch {
      continue;
    }
    if (!Number.isFinite(micro) || micro <= 0) continue;

    const intent = await prisma.depositIntent.findFirst({
      where: {
        status: "pending",
        asset: "USDT",
        network: "TRC20",
        amountUsdtMicro: micro,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: { createdAt: "asc" },
    });

    if (intent) {
      try {
        await confirmDepositIntent(intent.id, {
          txid: tx.transaction_id,
          confirmedBy: "auto",
        });
        matched += 1;
        log?.info?.(
          {
            intentId: intent.id,
            txid: tx.transaction_id,
            usdt: formatUsdtMicro(micro),
          },
          "deposit_auto_confirmed",
        );
      } catch (e) {
        log?.warn?.(
          { err: e instanceof Error ? e.message : e, txid: tx.transaction_id },
          "deposit_auto_confirm_failed",
        );
      }
      continue;
    }

    await prisma.unmatchedDeposit.create({
      data: {
        txid: tx.transaction_id,
        amountUsdtMicro: micro,
        fromAddress: tx.from,
        toAddress: tx.to,
        note: `No pending intent for ${formatUsdtMicro(micro)} USDT`,
      },
    });
    unmatched += 1;
  }

  lastMatched = matched;
  lastOkAt = new Date().toISOString();
  lastError = null;
  return { matched, unmatched, expired };
}

export function startTronWatcher(log: {
  info: (o: unknown, msg?: string) => void;
  warn: (o: unknown, msg?: string) => void;
  error: (o: unknown, msg?: string) => void;
}) {
  if (!config.tronWatchEnabled) {
    log.info({}, "tron_watch_disabled");
    return;
  }
  if (!config.tronUsdtAddress) {
    log.warn({}, "tron_watch_enabled_but_no_address");
    return;
  }
  if (timer) return;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const r = await pollTronUsdtDeposits(log);
      if (r.matched || r.unmatched || r.expired) {
        log.info(r, "tron_watch_tick");
      }
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      log.error({ err: lastError }, "tron_watch_error");
    } finally {
      running = false;
    }
  };

  void tick();
  timer = setInterval(() => void tick(), config.tronWatchIntervalMs);
  log.info(
    {
      provider: "trongrid",
      address: config.tronUsdtAddress,
      intervalMs: config.tronWatchIntervalMs,
      hasApiKey: Boolean(config.trongridApiKey),
    },
    "tron_watch_started",
  );
}
