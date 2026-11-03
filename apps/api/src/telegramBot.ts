/**
 * Lightweight Telegram bot: /start greeting + Mini App button.
 * Uses long polling so it keeps working when the Cloudflare tunnel URL changes.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { config } from "./config.js";

const BRAND_NAME = "Hold'em House";

type TgUpdate = {
  update_id: number;
  message?: {
    message_id: number;
    text?: string;
    chat: { id: number; type: string };
    from?: { id: number; first_name?: string; language_code?: string };
  };
};

type Logger = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
};

function botApiBase(): string | null {
  const token = config.telegramBotToken.trim();
  if (!token) return null;
  return `https://api.telegram.org/bot${token}`;
}

/** HTTPS URL of the Mini App static (same as BotFather / CORS). */
export function resolveMiniAppUrl(): string {
  const fromEnv = (process.env.MINI_APP_URL ?? "").trim().replace(/\/$/, "");
  if (fromEnv.startsWith("https://")) return fromEnv;
  const cors = (config.corsOrigin ?? "").trim().replace(/\/$/, "");
  if (cors.startsWith("https://")) return cors;
  return "https://kiosk-hedgehog22.eu.pythonanywhere.com";
}

async function tgCall(
  method: string,
  body?: Record<string, unknown>,
): Promise<unknown> {
  const base = botApiBase();
  if (!base) throw new Error("TELEGRAM_BOT_TOKEN missing");
  const res = await fetch(`${base}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json()) as { ok?: boolean; description?: string };
  if (!res.ok || data.ok === false) {
    throw new Error(data.description ?? `Telegram ${method} failed`);
  }
  return data;
}

function resolveBrandLogoPath(): string | null {
  const fromEnv = (process.env.BRAND_LOGO_PATH ?? "").trim();
  const candidates = [
    fromEnv,
    join(process.cwd(), "public", "brand", "logo.png"),
    join(process.cwd(), "..", "web", "public", "brand", "logo.png"),
    join(homedir(), "poker_room", "apps", "web", "public", "brand", "logo.png"),
    join(homedir(), "poker_room_static", "brand", "logo.png"),
  ].filter(Boolean);
  for (const p of candidates) {
    if (p && existsSync(p)) return p;
  }
  return null;
}

/** Display name + avatar for the bot (Hold'em House branding). */
async function syncBotBrand(log: Logger): Promise<void> {
  try {
    await tgCall("setMyName", { name: BRAND_NAME });
  } catch (e) {
    log.warn(
      { err: e instanceof Error ? e.message : String(e) },
      "telegram_set_my_name_failed",
    );
  }

  try {
    await tgCall("setMyDescription", {
      description:
        "Hold'em House — закрытый Texas Hold'em. Войдите по коду клуба или стола и откройте мини-приложение.",
    });
    await tgCall("setMyShortDescription", {
      short_description: "Hold'em House · private Hold'em club",
    });
  } catch (e) {
    log.warn(
      { err: e instanceof Error ? e.message : String(e) },
      "telegram_set_description_failed",
    );
  }

  const logoPath = resolveBrandLogoPath();
  if (!logoPath) {
    log.warn({}, "telegram_brand_logo_missing");
    return;
  }

  try {
    const base = botApiBase();
    if (!base) return;
    const buf = readFileSync(logoPath);
    const form = new FormData();
    form.append(
      "photo",
      JSON.stringify({ type: "static", photo: "attach://logo" }),
    );
    form.append(
      "logo",
      new Blob([new Uint8Array(buf)], { type: "image/png" }),
      "logo.png",
    );
    const res = await fetch(`${base}/setMyProfilePhoto`, {
      method: "POST",
      body: form,
    });
    const data = (await res.json()) as { ok?: boolean; description?: string };
    if (!res.ok || data.ok === false) {
      throw new Error(data.description ?? "setMyProfilePhoto failed");
    }
    log.info({ logoPath }, "telegram_profile_photo_ok");
  } catch (e) {
    log.warn(
      { err: e instanceof Error ? e.message : String(e), logoPath },
      "telegram_set_profile_photo_failed",
    );
  }
}

function startPayload(text: string | undefined): string | null {
  if (!text) return null;
  const m = text.trim().match(/^\/start(?:@\w+)?(?:\s+(.+))?$/i);
  return m ? (m[1]?.trim() ?? "") : null;
}

function welcomeCopy(lang?: string): { text: string; button: string } {
  const ru = !lang || lang.toLowerCase().startsWith("ru");
  if (ru) {
    return {
      text:
        `<b>${BRAND_NAME}</b>\n\n` +
        "Рады видеть вас за сукном.\n" +
        "Закрытый Texas Hold'em для своих — войдите по коду клуба или стола.\n\n" +
        "Нажмите кнопку ниже, чтобы открыть мини-приложение.",
      button: "Открыть клуб",
    };
  }
  return {
    text:
      `<b>${BRAND_NAME}</b>\n\n` +
      "Glad to see you at the felt.\n" +
      "Private Texas Hold'em — enter with a club or table code.\n\n" +
      "Tap the button below to open the mini app.",
    button: "Open club",
  };
}

export async function sendStartGreeting(
  chatId: number,
  opts?: { languageCode?: string; deepLink?: string },
): Promise<void> {
  const mini = resolveMiniAppUrl();
  const openUrl =
    opts?.deepLink && opts.deepLink.length > 0
      ? `${mini}/?invite=${encodeURIComponent(opts.deepLink)}`
      : `${mini}/`;
  const copy = welcomeCopy(opts?.languageCode);

  await tgCall("sendMessage", {
    chat_id: chatId,
    text: copy.text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: {
      // Button under the composer — opens the Mini App
      keyboard: [[{ text: copy.button, web_app: { url: openUrl } }]],
      resize_keyboard: true,
      is_persistent: true,
    },
  });
}

async function handleUpdate(update: TgUpdate, log: Logger): Promise<void> {
  const msg = update.message;
  if (!msg?.text || msg.chat.type !== "private") return;
  const payload = startPayload(msg.text);
  if (payload === null) return;

  try {
    await sendStartGreeting(msg.chat.id, {
      languageCode: msg.from?.language_code,
      deepLink: payload || undefined,
    });
    log.info(
      { chatId: msg.chat.id, deepLink: payload || null },
      "telegram_start_ok",
    );
  } catch (e) {
    log.error(
      { err: e instanceof Error ? e.message : String(e), chatId: msg.chat.id },
      "telegram_start_failed",
    );
  }
}

/**
 * Drop any webhook and long-poll getUpdates. Safe to call once at API boot.
 */
export function startTelegramBot(log: Logger): void {
  if (!botApiBase()) {
    log.warn({}, "telegram_bot_skipped_no_token");
    return;
  }

  let offset = 0;
  let stopped = false;

  const boot = async () => {
    try {
      await tgCall("deleteWebhook", { drop_pending_updates: false });
    } catch (e) {
      log.warn(
        { err: e instanceof Error ? e.message : String(e) },
        "telegram_delete_webhook_failed",
      );
    }

    // Keep Menu Button pointed at the Mini App (BotFather may already set this).
    try {
      await tgCall("setChatMenuButton", {
        menu_button: {
          type: "web_app",
          text: "Открыть",
          web_app: { url: resolveMiniAppUrl() + "/" },
        },
      });
    } catch (e) {
      log.warn(
        { err: e instanceof Error ? e.message : String(e) },
        "telegram_menu_button_failed",
      );
    }

    await syncBotBrand(log);

    log.info({ miniApp: resolveMiniAppUrl() }, "telegram_bot_polling");

    while (!stopped) {
      try {
        const base = botApiBase();
        if (!base) break;
        const res = await fetch(
          `${base}/getUpdates?timeout=25&offset=${offset}&allowed_updates=${encodeURIComponent(JSON.stringify(["message"]))}`,
        );
        const data = (await res.json()) as {
          ok?: boolean;
          result?: TgUpdate[];
          description?: string;
        };
        if (!data.ok || !Array.isArray(data.result)) {
          log.warn(
            { err: data.description ?? "getUpdates failed" },
            "telegram_get_updates_failed",
          );
          await new Promise((r) => setTimeout(r, 3000));
          continue;
        }
        for (const upd of data.result) {
          offset = upd.update_id + 1;
          await handleUpdate(upd, log);
        }
      } catch (e) {
        log.warn(
          { err: e instanceof Error ? e.message : String(e) },
          "telegram_poll_error",
        );
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  };

  void boot();

  // Soft stop hook for tests / future graceful shutdown
  (startTelegramBot as { stop?: () => void }).stop = () => {
    stopped = true;
  };
}
