import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";

export interface TelegramWebAppUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
}

export function validateInitData(initData: string): TelegramWebAppUser {
  // Allow Mini App ?dev=1 probes. Read env directly as well as config —
  // always-on restarts can race dotenv vs process env.
  const bypass =
    config.devBypassAuth || process.env.DEV_BYPASS_AUTH === "1";
  if (bypass && initData.startsWith("dev:")) {
    // format: dev:<telegramId>:<name>
    const parts = initData.split(":");
    const id = Number(parts[1] || 1);
    const name = parts[2] || `Dev${id}`;
    return { id, first_name: name, username: `dev_${id}` };
  }

  if (!config.telegramBotToken) {
    throw new Error("TELEGRAM_BOT_TOKEN not configured");
  }

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) throw new Error("Missing hash");
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secretKey = createHmac("sha256", "WebAppData")
    .update(config.telegramBotToken)
    .digest();
  const calculated = createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  const a = Buffer.from(calculated, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error("Invalid initData signature");
  }

  const authDate = Number(params.get("auth_date") ?? 0);
  if (Date.now() / 1000 - authDate > 86400) {
    throw new Error("initData expired");
  }

  const userRaw = params.get("user");
  if (!userRaw) throw new Error("Missing user");
  return JSON.parse(userRaw) as TelegramWebAppUser;
}
