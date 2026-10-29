import "dotenv/config";

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
  /**
   * Indexer for incoming USDT: tronscan (preferred) | trongrid.
   * Auto: tronscan if TRONSCAN_API_KEY set, else trongrid.
   */
  tronProvider: (() => {
    const raw = (process.env.TRON_PROVIDER ?? "").trim().toLowerCase();
    if (raw === "tronscan" || raw === "trongrid") return raw;
    return (process.env.TRONSCAN_API_KEY ?? "").trim()
      ? ("tronscan" as const)
      : ("trongrid" as const);
  })(),
  tronscanApiKey: (process.env.TRONSCAN_API_KEY ?? "").trim(),
  tronscanBase: (
    process.env.TRONSCAN_BASE_URL ?? "https://apilist.tronscanapi.com"
  ).replace(/\/$/, ""),
  trongridApiKey: (process.env.TRONGRID_API_KEY ?? "").trim(),
  trongridBase: (
    process.env.TRONGRID_BASE_URL ?? "https://api.trongrid.io"
  ).replace(/\/$/, ""),
  /** How many chips one whole USDT buys */
  chipsPerUsdt: Number(process.env.CHIPS_PER_USDT ?? 100),
  depositTtlMinutes: Number(process.env.DEPOSIT_TTL_MINUTES ?? 60),
  /** Poll indexer for incoming USDT (needs TRON_USDT_ADDRESS) */
  tronWatchEnabled: process.env.TRON_WATCH_ENABLED === "1",
  tronWatchIntervalMs: Number(process.env.TRON_WATCH_INTERVAL_MS ?? 20_000),
};
