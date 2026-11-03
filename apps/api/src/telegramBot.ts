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
  callback_query?: {
    id: string;
    data?: string;
    from: { id: number; language_code?: string };
    message?: {
      message_id: number;
      chat: { id: number };
      text?: string;
    };
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

function welcomeCopy(lang?: string): {
  text: string;
  button: string;
  menuHint: string;
} {
  const ru = !lang || lang.toLowerCase().startsWith("ru");
  if (ru) {
    return {
      text:
        `<b>${BRAND_NAME}</b>\n\n` +
        "Рады видеть вас за сукном.\n" +
        "Закрытый Texas Hold'em для своих — войдите по коду клуба или стола.\n\n" +
        "Нажмите кнопку под этим сообщением, чтобы открыть мини-приложение.",
      button: "Открыть клуб",
      menuHint:
        "Также можно открыть клуб кнопкой меню бота (☰ / «Открыть»).",
    };
  }
  return {
    text:
      `<b>${BRAND_NAME}</b>\n\n` +
      "Glad to see you at the felt.\n" +
      "Private Texas Hold'em — enter with a club or table code.\n\n" +
      "Tap the button under this message to open the mini app.",
    button: "Open club",
    menuHint: "You can also open the club via the bot menu button.",
  };
}

function normalizeStartDeepLink(raw: string): string {
  let c = raw.trim();
  if (/^ref[_-]/i.test(c)) {
    c = c.replace(/^ref[_-]/i, "");
    if (!/^(REF|CLUB|TBL)-/i.test(c)) c = `REF-${c}`;
  }
  return c.toUpperCase();
}

export async function sendStartGreeting(
  chatId: number,
  opts?: { languageCode?: string; deepLink?: string },
): Promise<void> {
  const mini = resolveMiniAppUrl();
  const deep =
    opts?.deepLink && opts.deepLink.length > 0
      ? normalizeStartDeepLink(opts.deepLink)
      : "";
  const openUrl = deep
    ? `${mini}/?invite=${encodeURIComponent(deep)}`
    : `${mini}/`;
  const copy = welcomeCopy(opts?.languageCode);

  // Inline web_app under the message — reliable initData.
  // Reply-keyboard web_app is flaky on some clients (empty initData).
  await tgCall("sendMessage", {
    chat_id: chatId,
    text: copy.text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: {
      inline_keyboard: [[{ text: copy.button, web_app: { url: openUrl } }]],
    },
  });
  // Drop any old reply-keyboard "Open" that may open without initData
  try {
    await tgCall("sendMessage", {
      chat_id: chatId,
      text: copy.menuHint,
      reply_markup: { remove_keyboard: true },
    });
  } catch {
    /* non-fatal */
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export async function notifyUserWithdrawPending(opts: {
  telegramId: string;
  amountChips: number;
  amountUsdt: string;
}): Promise<void> {
  const chatId = Number(opts.telegramId);
  if (!Number.isFinite(chatId)) return;
  await tgCall("sendMessage", {
    chat_id: chatId,
    text:
      `<b>${BRAND_NAME}</b>\n\n` +
      `Заявка на вывод <b>${opts.amountChips}</b> фишек (~${escapeHtml(opts.amountUsdt)} USDT) принята и <b>в обработке</b>.\n` +
      "Когда админ отправит выплату, мы сообщим сюда.",
    parse_mode: "HTML",
    disable_web_page_preview: true,
  });
}

export async function notifyUserWithdrawPaid(opts: {
  telegramId: string;
  amountUsdt: string;
  address: string;
}): Promise<void> {
  const chatId = Number(opts.telegramId);
  if (!Number.isFinite(chatId)) return;
  await tgCall("sendMessage", {
    chat_id: chatId,
    text:
      `<b>${BRAND_NAME}</b>\n\n` +
      `Выплата <b>${escapeHtml(opts.amountUsdt)} USDT</b> (TRC20) отправлена.\n` +
      `Адрес: <code>${escapeHtml(opts.address)}</code>`,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  });
}

export async function notifyUserWithdrawRejected(opts: {
  telegramId: string;
  amountChips: number;
}): Promise<void> {
  const chatId = Number(opts.telegramId);
  if (!Number.isFinite(chatId)) return;
  await tgCall("sendMessage", {
    chat_id: chatId,
    text:
      `<b>${BRAND_NAME}</b>\n\n` +
      `Заявка на вывод отклонена. <b>${opts.amountChips}</b> фишек возвращены на баланс.`,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  });
}

/** Notify all configured admins with pay/reject buttons. */
export async function notifyAdminsWithdrawRequest(opts: {
  intentId: string;
  amountChips: number;
  amountUsdt: string;
  address: string;
  network: string;
  userName: string;
  userTelegramId: string;
}): Promise<void> {
  const text =
    `<b>Вывод USDT</b>\n\n` +
    `Игрок: ${escapeHtml(opts.userName)} (TG <code>${escapeHtml(opts.userTelegramId)}</code>)\n` +
    `Фишки: <b>${opts.amountChips}</b>\n` +
    `Сумма: <b>${escapeHtml(opts.amountUsdt)} USDT</b>\n` +
    `Сеть: <b>${escapeHtml(opts.network)}</b>\n` +
    `Адрес:\n<code>${escapeHtml(opts.address)}</code>`;

  const reply_markup = {
    inline_keyboard: [
      [
        {
          text: "Выплатить",
          callback_data: `wd:pay:${opts.intentId}`,
        },
        {
          text: "Отклонить",
          callback_data: `wd:reject:${opts.intentId}`,
        },
      ],
    ],
  };

  for (const id of config.adminTelegramIds) {
    const chatId = Number(id);
    if (!Number.isFinite(chatId)) continue;
    try {
      await tgCall("sendMessage", {
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        reply_markup,
      });
    } catch {
      /* one admin fail should not block others */
    }
  }
}

async function handleWithdrawCallback(
  cq: NonNullable<TgUpdate["callback_query"]>,
  log: Logger,
): Promise<void> {
  const data = cq.data ?? "";
  const m = data.match(/^wd:(pay|reject):([a-z0-9]+)$/i);
  if (!m) {
    await tgCall("answerCallbackQuery", {
      callback_query_id: cq.id,
      text: "Unknown action",
      show_alert: false,
    });
    return;
  }

  const action = m[1]!.toLowerCase() as "pay" | "reject";
  const intentId = m[2]!;
  const adminId = String(cq.from.id);

  if (!config.adminTelegramIds.includes(adminId)) {
    await tgCall("answerCallbackQuery", {
      callback_query_id: cq.id,
      text: "Нет прав",
      show_alert: true,
    });
    return;
  }

  const { payWithdrawIntent, rejectWithdrawIntent } = await import(
    "./withdrawService.js"
  );

  try {
    if (action === "pay") {
      const r = await payWithdrawIntent(intentId, adminId);
      try {
        await notifyUserWithdrawPaid({
          telegramId: r.userTelegramId,
          amountUsdt: r.intent.amountUsdt,
          address: r.intent.address,
        });
      } catch (e) {
        log.warn(
          { err: e instanceof Error ? e.message : String(e) },
          "withdraw_user_paid_notify_failed",
        );
      }
      await tgCall("answerCallbackQuery", {
        callback_query_id: cq.id,
        text: "Отмечено как выплачено",
      });
      if (cq.message) {
        await tgCall("editMessageText", {
          chat_id: cq.message.chat.id,
          message_id: cq.message.message_id,
          text:
            `<b>Вывод USDT — выплачено</b>\n\n` +
            `Игрок: ${escapeHtml(r.userName)} (TG <code>${escapeHtml(r.userTelegramId)}</code>)\n` +
            `Фишки: <b>${r.intent.amountChips}</b>\n` +
            `Сумма: <b>${escapeHtml(r.intent.amountUsdt)} USDT</b>\n` +
            `Сеть: <b>${escapeHtml(r.intent.network)}</b>\n` +
            `Адрес:\n<code>${escapeHtml(r.intent.address)}</code>\n\n` +
            `Админ: <code>${escapeHtml(adminId)}</code>`,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        });
      }
      log.info({ intentId, adminId }, "withdraw_paid");
      return;
    }

    const r = await rejectWithdrawIntent(intentId, adminId);
    try {
      await notifyUserWithdrawRejected({
        telegramId: r.userTelegramId,
        amountChips: r.intent.amountChips,
      });
    } catch (e) {
      log.warn(
        { err: e instanceof Error ? e.message : String(e) },
        "withdraw_user_reject_notify_failed",
      );
    }
    await tgCall("answerCallbackQuery", {
      callback_query_id: cq.id,
      text: "Отклонено, фишки возвращены",
    });
    if (cq.message) {
      await tgCall("editMessageText", {
        chat_id: cq.message.chat.id,
        message_id: cq.message.message_id,
        text:
          `<b>Вывод USDT — отклонено</b>\n\n` +
          `Игрок: ${escapeHtml(r.userName)} (TG <code>${escapeHtml(r.userTelegramId)}</code>)\n` +
          `Фишки возвращены: <b>${r.intent.amountChips}</b>\n` +
          `Адрес:\n<code>${escapeHtml(r.intent.address)}</code>\n\n` +
          `Админ: <code>${escapeHtml(adminId)}</code>`,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      });
    }
    log.info({ intentId, adminId }, "withdraw_rejected");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await tgCall("answerCallbackQuery", {
      callback_query_id: cq.id,
      text: msg.slice(0, 180),
      show_alert: true,
    });
    log.warn({ err: msg, intentId, action }, "withdraw_callback_failed");
  }
}

async function handleUpdate(update: TgUpdate, log: Logger): Promise<void> {
  if (update.callback_query) {
    await handleWithdrawCallback(update.callback_query, log);
    return;
  }

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
          `${base}/getUpdates?timeout=25&offset=${offset}&allowed_updates=${encodeURIComponent(JSON.stringify(["message", "callback_query"]))}`,
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
