import { config } from "./config.js";
import { applyIncomingUsdtBatch } from "./depositMatch.js";
import { expireStaleDeposits } from "./depositService.js";

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
  if (!config.tronUsdtAddress) {
    const expired = await expireStaleDeposits();
    return { matched: 0, unmatched: 0, expired };
  }

  const txs = await fetchIncomingUsdt();
  const now = Date.now();
  const lookbackMs = Math.max(config.depositTtlMinutes, 60) * 60_000 * 2;

  const batch = txs
    .filter((tx) => {
      if (!tx.transaction_id || !tx.value) return false;
      if (tx.to && tx.to !== config.tronUsdtAddress) return false;
      if (now - (tx.block_timestamp || 0) > lookbackMs) return false;
      const micro = Number(tx.value);
      return Number.isFinite(micro) && micro > 0;
    })
    .map((tx) => ({
      txid: tx.transaction_id,
      amountUsdtMicro: Number(tx.value),
      fromAddress: tx.from,
      toAddress: tx.to,
    }));

  const result = await applyIncomingUsdtBatch(batch, log);
  lastMatched = result.matched;
  lastOkAt = new Date().toISOString();
  lastError = null;
  return result;
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
