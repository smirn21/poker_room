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
};
