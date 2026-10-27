import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { en } from "./locales/en";
import { ru, type MessageKey } from "./locales/ru";

export type Locale = "ru" | "en";

const STORAGE_KEY = "poker_locale";

const catalogs: Record<Locale, Record<MessageKey, string>> = { ru, en };

type Vars = Record<string, string | number>;

function detectLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "ru" || saved === "en") return saved;
  } catch {
    /* ignore */
  }
  const tgLang =
    (
      window as Window & {
        Telegram?: { WebApp?: { initDataUnsafe?: { user?: { language_code?: string } } } };
      }
    ).Telegram?.WebApp?.initDataUnsafe?.user?.language_code ?? "";
  if (tgLang.toLowerCase().startsWith("ru")) return "ru";
  if (tgLang.toLowerCase().startsWith("en")) return "en";
  const nav = (navigator.language || "").toLowerCase();
  if (nav.startsWith("ru")) return "ru";
  if (nav.startsWith("en")) return "en";
  return "ru";
}

function format(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    vars[key] === undefined ? `{${key}}` : String(vars[key]),
  );
}

type I18nValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey, vars?: Vars) => string;
};

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => detectLocale());

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const t = useCallback(
    (key: MessageKey, vars?: Vars) => {
      const catalog = catalogs[locale] ?? catalogs.ru;
      return format(catalog[key] ?? catalogs.ru[key] ?? key, vars);
    },
    [locale],
  );

  const value = useMemo(
    () => ({ locale, setLocale, t }),
    [locale, setLocale, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}

export function useT() {
  return useI18n().t;
}
