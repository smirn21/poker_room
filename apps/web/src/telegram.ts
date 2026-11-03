/** Telegram Mini App chrome + safe-area helpers. */

export type TgSafeInsets = {
  top: number;
  bottom: number;
  left: number;
  right: number;
};

type TgWebApp = {
  initData: string;
  initDataUnsafe?: {
    start_param?: string;
    user?: { id?: number; language_code?: string };
  };
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

/**
 * Keep layout height aligned with the *visible* viewport.
 * iOS / Telegram WebView often leave 100dvh full-screen when the software
 * keyboard opens; visualViewport shrinks — we mirror that into --vv-height.
 */
export function syncVisualViewport(): void {
  const root = document.documentElement;
  const vv = window.visualViewport;
  const height = vv ? vv.height : window.innerHeight;
  const offsetTop = vv?.offsetTop ?? 0;
  const obscured = Math.max(0, window.innerHeight - height - offsetTop);

  root.style.setProperty("--vv-height", `${Math.round(height)}px`);
  root.style.setProperty("--vv-offset-top", `${Math.round(offsetTop)}px`);
  root.style.setProperty("--keyboard-inset", `${Math.round(obscured)}px`);
  root.classList.toggle("keyboard-open", obscured > 80);
}

/** Bind visualViewport listeners; returns cleanup. Safe to call once at boot. */
export function bindVisualViewport(): () => void {
  const sync = () => syncVisualViewport();
  sync();
  const vv = window.visualViewport;
  vv?.addEventListener("resize", sync);
  vv?.addEventListener("scroll", sync);
  window.addEventListener("resize", sync);
  return () => {
    vv?.removeEventListener("resize", sync);
    vv?.removeEventListener("scroll", sync);
    window.removeEventListener("resize", sync);
  };
}

export function initTelegramChrome(opts?: {
  /** Fullscreen can drop/reload WebView on some clients — call after auth. */
  fullscreen?: boolean;
}): TgWebApp | null {
  const tg = window.Telegram?.WebApp ?? null;
  syncVisualViewport();
  if (!tg) return null;

  tg.ready();
  tg.expand();
  if (opts?.fullscreen) {
    try {
      tg.requestFullscreen?.();
    } catch {
      /* optional Bot API 8.0 */
    }
  }
  try {
    tg.setHeaderColor?.(FELT_HEADER);
    tg.setBackgroundColor?.(FELT_BG);
    tg.disableVerticalSwipes?.();
  } catch {
    /* older clients */
  }

  applyTelegramSafeAreaVars(tg);

  const sync = () => {
    applyTelegramSafeAreaVars(tg);
    syncVisualViewport();
  };
  tg.onEvent?.("safeAreaChanged", sync);
  tg.onEvent?.("contentSafeAreaChanged", sync);
  tg.onEvent?.("viewportChanged", sync);
  tg.onEvent?.("fullscreenChanged", sync);

  // Insets often arrive a tick after expand/fullscreen from chat list.
  window.setTimeout(sync, 50);
  window.setTimeout(sync, 300);

  return tg;
}

/** Ask Telegram for fullscreen after a successful session (safer for initData). */
export function requestTelegramFullscreen(): void {
  try {
    window.Telegram?.WebApp?.requestFullscreen?.();
  } catch {
    /* optional */
  }
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
