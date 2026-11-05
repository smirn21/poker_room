/** Telegram deep links for opening the Mini App on a table/club invite. */

import { composeTableReferralParam, normalizeInviteToken } from "@poker/shared";

const PENDING_TABLE_KEY = "hh_pending_table";

export function tgBotUsername(): string {
  const fromEnv = (import.meta.env.VITE_TG_BOT_USERNAME as string | undefined)
    ?.trim()
    .replace(/^@/, "");
  return fromEnv || "Wpt_room_bot";
}

/** Optional BotFather short name for a Direct Link Mini App. */
export function tgMiniAppShortName(): string | null {
  const n = (import.meta.env.VITE_TG_MINI_APP_SHORT_NAME as string | undefined)
    ?.trim()
    .replace(/^\//, "");
  return n || null;
}

/**
 * Opens Mini App with start_param (A–Z a–z 0–9 _ -).
 * Main Mini App: t.me/bot?startapp=…
 * Named app:     t.me/bot/short?startapp=…
 */
export function inviteDeepLink(param: string): string {
  const bot = tgBotUsername();
  const p = param.trim();
  const short = tgMiniAppShortName();
  if (short) {
    return `https://t.me/${bot}/${short}?startapp=${encodeURIComponent(p)}`;
  }
  return `https://t.me/${bot}?startapp=${encodeURIComponent(p)}`;
}

/** @deprecated use inviteDeepLink */
export function tableInviteDeepLink(code: string): string {
  return inviteDeepLink(code);
}

/** Referral + table seat: startapp=REF-…_TBL-… */
export function tableReferralDeepLink(
  refCode: string,
  tableCode: string,
): string {
  return inviteDeepLink(composeTableReferralParam(refCode, tableCode));
}

/** Invite from URL (?invite= / ?table= / tgWebAppStartParam) or WebApp start_param. */
export function resolveLaunchInviteCode(): string | null {
  const q = new URLSearchParams(window.location.search);
  const fromQuery =
    q.get("invite") ?? q.get("table") ?? q.get("tgWebAppStartParam");
  const fromStart = window.Telegram?.WebApp?.initDataUnsafe?.start_param;
  const raw = (fromQuery || fromStart || "").trim();
  if (!raw) return null;
  const normalized = normalizeInviteToken(raw);
  return normalized || null;
}

export function readPendingTableId(): string | null {
  try {
    return sessionStorage.getItem(PENDING_TABLE_KEY);
  } catch {
    return null;
  }
}

export function writePendingTableId(id: string | null): void {
  try {
    if (!id) sessionStorage.removeItem(PENDING_TABLE_KEY);
    else sessionStorage.setItem(PENDING_TABLE_KEY, id);
  } catch {
    /* private mode */
  }
}
