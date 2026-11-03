/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_WS_URL: string;
  /** Telegram bot username without @ (for t.me deep links). */
  readonly VITE_TG_BOT_USERNAME?: string;
  /** Optional Direct Link Mini App short name from BotFather. */
  readonly VITE_TG_MINI_APP_SHORT_NAME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
