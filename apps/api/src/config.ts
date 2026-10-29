import "dotenv/config";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function resolvePublicApiUrl(): string {
  const fromEnv = (process.env.PUBLIC_API_URL ?? "").trim().replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  // PA always-on writes the live tunnel here after cloudflared starts.
  const candidates = [
    join(homedir(), "poker_room_api_url.txt"),
    join(process.cwd(), "..", "..", "poker_room_api_url.txt"),
  ];
  for (const path of candidates) {
    try {
      if (!existsSync(path)) continue;
      const url = readFileSync(path, "utf8").trim().replace(/\/$/, "");
      if (url.startsWith("https://")) return url;
    } catch {
      /* ignore */
    }
  }
  return "";
}

export const config = {
  port: Number(process.env.PORT ?? 3001),
  jwtSecret: process.env.JWT_SECRET ?? "dev-secret-change-me",
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
  // Default ON so Mini App ?dev=1 works on PA even if .env load is flaky.
  // Set DEV_BYPASS_AUTH=0 explicitly to require real Telegram initData.
  devBypassAuth: process.env.DEV_BYPASS_AUTH !== "0",
  signupBonus: Number(process.env.SIGNUP_BONUS_CHIPS ?? 10_000),
  adminTelegramIds: (process.env.ADMIN_TELEGRAM_IDS ?? "1")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  databaseUrl: process.env.DATABASE_URL ?? "file:./dev.db",
  /** Seconds a busted player has to rebuy before being removed */
  rebuyGraceSeconds: Number(process.env.REBUY_GRACE_SECONDS ?? 300),

  /** USDT TRC20 club receive address (Trust Wallet / your wallet). */
  tronUsdtAddress: (process.env.TRON_USDT_ADDRESS ?? "").trim(),
  tronUsdtContract: (
    process.env.TRON_USDT_CONTRACT ?? "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"
  ).trim(),
  /** Optional TronGrid key; empty = public rate-limited endpoint */
  trongridApiKey: (process.env.TRONGRID_API_KEY ?? "").trim(),
  trongridBase: (
    process.env.TRONGRID_BASE_URL ?? "https://api.trongrid.io"
  ).replace(/\/$/, ""),
  /**
   * Public HTTPS base of this API (cloudflare tunnel URL).
   * Used to register TronHooks webhook: {PUBLIC_API_URL}/webhooks/tronhooks
   * Falls back to ~/poker_room_api_url.txt on PythonAnywhere.
   */
  publicApiUrl: resolvePublicApiUrl(),
  /** TronHooks API key (tw_live_…) — create/list watches */
  tronhooksApiKey: (process.env.TRONHOOKS_API_KEY ?? "").trim(),
  /** whsec_… shown once when watch is created — verify X-Signature */
  tronhooksWebhookSecret: (process.env.TRONHOOKS_WEBHOOK_SECRET ?? "").trim(),
  /**
   * Accept TronHooks webhooks (needs TRONHOOKS_WEBHOOK_SECRET + TRON_USDT_ADDRESS).
   * Default ON when secret is present.
   */
  tronhooksEnabled:
    process.env.TRONHOOKS_ENABLED === "1" ||
    (process.env.TRONHOOKS_ENABLED !== "0" &&
      Boolean((process.env.TRONHOOKS_WEBHOOK_SECRET ?? "").trim())),
  /** How many chips one whole USDT buys */
  chipsPerUsdt: Number(process.env.CHIPS_PER_USDT ?? 100),
  depositTtlMinutes: Number(process.env.DEPOSIT_TTL_MINUTES ?? 60),
  /**
   * Optional TronGrid poll fallback. Prefer TronHooks webhooks.
   * Set TRON_WATCH_ENABLED=1 only if you need poll backup.
   */
  tronWatchEnabled: process.env.TRON_WATCH_ENABLED === "1",
  tronWatchIntervalMs: Number(process.env.TRON_WATCH_INTERVAL_MS ?? 60_000),
};
