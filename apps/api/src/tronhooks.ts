import { createHmac, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { config, resolvePublicApiUrl } from "./config.js";
import { prisma } from "./db.js";
import { applyIncomingUsdtTransfer } from "./depositMatch.js";
import { expireStaleDeposits } from "./depositService.js";

const API = "https://tronhooks.com/v1";

let lastEventAt: string | null = null;
let lastError: string | null = null;
let lastResult: string | null = null;

export type TronhooksEvent = {
  api_version?: string;
  event_id: string;
  type: string;
  direction?: string;
  network?: string;
  asset?: string;
  contract?: string | null;
  tx_id: string;
  from?: string;
  to?: string;
  amount_raw: string;
  amount?: string;
  watch_id?: string;
};

export function tronhooksStatus() {
  const publicUrl = config.publicApiUrl.replace(/\/$/, "");
  return {
    enabled: Boolean(
      config.tronhooksEnabled &&
        config.tronUsdtAddress &&
        config.tronhooksWebhookSecret,
    ),
    hasApiKey: Boolean(config.tronhooksApiKey),
    hasSecret: Boolean(config.tronhooksWebhookSecret),
    address: config.tronUsdtAddress || null,
    webhookUrl: publicUrl
      ? `${publicUrl}/webhooks/tronhooks`
      : null,
    lastEventAt,
    lastError,
    lastResult,
  };
}

export function verifyTronhooksSignature(
  rawBody: Buffer,
  signatureHex: string | undefined,
  secret: string,
): boolean {
  if (!secret || !signatureHex || !/^[a-f0-9]{64}$/i.test(signatureHex)) {
    return false;
  }
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  let given: Buffer;
  try {
    given = Buffer.from(signatureHex, "hex");
  } catch {
    return false;
  }
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export async function processTronhooksEvent(
  event: TronhooksEvent,
  log?: {
    info: (o: unknown, msg?: string) => void;
    warn: (o: unknown, msg?: string) => void;
  },
): Promise<{ ok: true; result: string }> {
  await expireStaleDeposits();

  try {
    await prisma.webhookInbox.create({
      data: {
        id: event.event_id,
        source: "tronhooks",
        txid: event.tx_id,
      },
    });
  } catch {
    const exists = await prisma.webhookInbox.findUnique({
      where: { id: event.event_id },
    });
    if (exists) {
      lastEventAt = new Date().toISOString();
      lastResult = "duplicate_event";
      lastError = null;
      return { ok: true, result: "duplicate_event" };
    }
    throw new Error("webhook inbox insert failed");
  }

  if (event.type !== "transfer.confirmed") {
    lastResult = "ignored_type";
    return { ok: true, result: "ignored_type" };
  }
  if (event.network && event.network !== "mainnet") {
    lastResult = "ignored_network";
    return { ok: true, result: "ignored_network" };
  }
  if (event.asset !== "USDT") {
    lastResult = "ignored_asset";
    return { ok: true, result: "ignored_asset" };
  }
  if (event.direction && event.direction !== "incoming") {
    lastResult = "ignored_direction";
    return { ok: true, result: "ignored_direction" };
  }
  if (
    config.tronUsdtAddress &&
    event.to &&
    event.to !== config.tronUsdtAddress
  ) {
    lastResult = "ignored_address";
    return { ok: true, result: "ignored_address" };
  }

  const micro = Number(event.amount_raw);
  if (!Number.isFinite(micro) || micro <= 0) {
    throw new Error("Invalid amount_raw");
  }

  const result = await applyIncomingUsdtTransfer(
    {
      txid: event.tx_id,
      amountUsdtMicro: micro,
      fromAddress: event.from,
      toAddress: event.to,
    },
    log,
  );

  lastEventAt = new Date().toISOString();
  lastResult = result;
  lastError = null;
  log?.info?.(
    { eventId: event.event_id, txid: event.tx_id, result },
    "tronhooks_event_processed",
  );
  return { ok: true, result };
}

export function markTronhooksError(err: string) {
  lastError = err;
}

type WatchRow = {
  id: string;
  address: string;
  asset_filter: string;
  direction: string;
  channel: string;
  webhook_url: string | null;
  status: string;
};

async function tronhooksFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  if (!config.tronhooksApiKey) {
    throw new Error("TRONHOOKS_API_KEY not set");
  }
  return fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.tronhooksApiKey}`,
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

export async function listTronhooksWatches(): Promise<WatchRow[]> {
  const res = await tronhooksFetch("/watches");
  if (!res.ok) {
    throw new Error(`TronHooks list ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as { data?: WatchRow[]; watches?: WatchRow[] };
  return json.data ?? json.watches ?? (Array.isArray(json) ? (json as WatchRow[]) : []);
}

export function expectedWebhookUrl(): string | null {
  const base = config.publicApiUrl.replace(/\/$/, "");
  if (!base) return null;
  return `${base}/webhooks/tronhooks`;
}

/**
 * Ensure an incoming USDT watch points at our public webhook URL.
 * Returns secret only when a new watch is created (shown once by TronHooks).
 */
export async function registerTronhooksWatch(opts?: {
  forceRecreate?: boolean;
}): Promise<{
  watchId: string;
  webhookUrl: string;
  secret: string | null;
  created: boolean;
  reused: boolean;
}> {
  const webhookUrl = expectedWebhookUrl();
  if (!webhookUrl) {
    throw new Error("PUBLIC_API_URL is required to register a TronHooks watch");
  }
  if (!config.tronUsdtAddress) {
    throw new Error("TRON_USDT_ADDRESS is required");
  }
  if (!config.tronhooksApiKey) {
    throw new Error("TRONHOOKS_API_KEY is required");
  }

  const watches = await listTronhooksWatches();
  const ours = watches.filter(
    (w) =>
      w.address === config.tronUsdtAddress &&
      w.asset_filter === "USDT" &&
      w.channel === "webhook",
  );
  const matching = ours.find((w) => w.webhook_url === webhookUrl);

  if (matching && !opts?.forceRecreate) {
    return {
      watchId: matching.id,
      webhookUrl,
      secret: null,
      created: false,
      reused: true,
    };
  }

  for (const w of ours) {
    if (opts?.forceRecreate || w.webhook_url !== webhookUrl) {
      const del = await tronhooksFetch(`/watches/${encodeURIComponent(w.id)}`, {
        method: "DELETE",
      });
      if (!del.ok && del.status !== 404) {
        throw new Error(`TronHooks delete ${del.status}: ${await del.text()}`);
      }
    }
  }

  const res = await tronhooksFetch("/watches", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      address: config.tronUsdtAddress,
      asset_filter: "USDT",
      direction: "incoming",
      webhook_url: webhookUrl,
    }),
  });

  if (res.status === 409) {
    const again = await listTronhooksWatches();
    const hit = again.find(
      (w) =>
        w.address === config.tronUsdtAddress &&
        w.webhook_url === webhookUrl,
    );
    if (hit) {
      return {
        watchId: hit.id,
        webhookUrl,
        secret: null,
        created: false,
        reused: true,
      };
    }
  }

  if (!res.ok) {
    throw new Error(`TronHooks create ${res.status}: ${await res.text()}`);
  }

  const created = (await res.json()) as WatchRow & { secret?: string };
  if (created.secret) {
    persistEnvValue("TRONHOOKS_WEBHOOK_SECRET", created.secret);
    persistEnvValue("PUBLIC_API_URL", resolvePublicApiUrl());
  }
  return {
    watchId: created.id,
    webhookUrl,
    secret: created.secret ?? null,
    created: true,
    reused: false,
  };
}

function persistEnvValue(key: string, value: string) {
  const path = join(homedir(), "poker_room", ".env");
  if (!existsSync(path)) return;
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  let found = false;
  const out = lines.map((line) => {
    if (line.startsWith(`${key}=`)) {
      found = true;
      return `${key}=${value}`;
    }
    return line;
  });
  if (!found) out.push(`${key}=${value}`);
  writeFileSync(path, out.join("\n") + (out[out.length - 1] === "" ? "" : "\n"));
  process.env[key] = value;
}

/** Keep TronHooks receiver URL aligned with the live tunnel after always-on restarts. */
export async function ensureTronhooksAligned(log?: {
  info: (o: unknown, msg?: string) => void;
  warn: (o: unknown, msg?: string) => void;
}) {
  if (!config.tronhooksApiKey || !config.tronUsdtAddress) {
    log?.info?.({}, "tronhooks_skip_align_missing_config");
    return;
  }
  if (!expectedWebhookUrl()) {
    log?.warn?.({}, "tronhooks_skip_align_no_public_url");
    return;
  }
  try {
    const r = await registerTronhooksWatch({ forceRecreate: false });
    log?.info?.(
      {
        watchId: r.watchId,
        webhookUrl: r.webhookUrl,
        created: r.created,
        reused: r.reused,
        secretPersisted: Boolean(r.secret),
      },
      "tronhooks_aligned",
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    markTronhooksError(msg);
    log?.warn?.({ err: msg }, "tronhooks_align_failed");
  }
}
