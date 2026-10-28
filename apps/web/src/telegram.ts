/** Telegram Mini App chrome + safe-area helpers. */

export type TgSafeInsets = {
  top: number;
  bottom: number;
  left: number;
  right: number;
};

type TgWebApp = {
  initData: string;
  ready: () => void;
  expand: () => void;
  requestFullscreen?: () => void;
  colorScheme?: string;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  disableVerticalSwipes?: () => void;
  safeAreaInset?: TgSafeInsets;
  contentSafeAreaInset?: TgSafeInsets;
  onEvent?: (event: string, cb: () => void) => void;
  offEvent?: (event: string, cb: () => void) => void;
  BackButton?: {
    show: () => void;
    hide: () => void;
    onClick: (cb: () => void) => void;
    offClick: (cb: () => void) => void;
  };
};

declare global {
  interface Window {
    Telegram?: { WebApp?: TgWebApp };
  }
}

const FELT_HEADER = "#0d3b2e";
const FELT_BG = "#082820";

function insetPx(n: number | undefined): string {
  return `${Math.max(0, n ?? 0)}px`;
}

/** Sync CSS vars from Telegram insets + keep env() fallbacks in styles.css. */
export function applyTelegramSafeAreaVars(tg?: TgWebApp | null): void {
  const root = document.documentElement;
  const safe = tg?.safeAreaInset;
  const content = tg?.contentSafeAreaInset;

  // Always define vars (0px when TG omits insets) so calc() in CSS is stable.
  root.style.setProperty("--tg-safe-area-inset-top", insetPx(safe?.top));
  root.style.setProperty("--tg-safe-area-inset-bottom", insetPx(safe?.bottom));
  root.style.setProperty("--tg-safe-area-inset-left", insetPx(safe?.left));
  root.style.setProperty("--tg-safe-area-inset-right", insetPx(safe?.right));

  root.style.setProperty(
    "--tg-content-safe-area-inset-top",
    insetPx(content?.top),
  );
  root.style.setProperty(
    "--tg-content-safe-area-inset-bottom",
    insetPx(content?.bottom),
  );
  root.style.setProperty(
    "--tg-content-safe-area-inset-left",
    insetPx(content?.left),
  );
  root.style.setProperty(
    "--tg-content-safe-area-inset-right",
    insetPx(content?.right),
  );
}

export function initTelegramChrome(): TgWebApp | null {
  const tg = window.Telegram?.WebApp ?? null;
  if (!tg) return null;

  tg.ready();
  tg.expand();
  try {
    tg.requestFullscreen?.();
  } catch {
    /* optional Bot API 8.0 — chat-list opens often need this for content insets */
  }
  try {
    tg.setHeaderColor?.(FELT_HEADER);
    tg.setBackgroundColor?.(FELT_BG);
    tg.disableVerticalSwipes?.();
  } catch {
    /* older clients */
  }

  applyTelegramSafeAreaVars(tg);

  const sync = () => applyTelegramSafeAreaVars(tg);
  tg.onEvent?.("safeAreaChanged", sync);
  tg.onEvent?.("contentSafeAreaChanged", sync);
  tg.onEvent?.("viewportChanged", sync);
  tg.onEvent?.("fullscreenChanged", sync);

  // Insets often arrive a tick after expand/fullscreen from chat list.
  window.setTimeout(sync, 50);
  window.setTimeout(sync, 300);

  return tg;
}

/** Show Telegram native Back when available; returns cleanup. */
export function bindTelegramBackButton(onBack: () => void): () => void {
  const btn = window.Telegram?.WebApp?.BackButton;
  if (!btn) return () => undefined;

  const handler = () => onBack();
  btn.onClick(handler);
  btn.show();
  return () => {
    btn.offClick(handler);
    btn.hide();
  };
}
