import { useI18n, type Locale } from "./index";

export function LanguageSwitcher({ className = "" }: { className?: string }) {
  const { locale, setLocale, t } = useI18n();

  return (
    <label className={`lang-switch ${className}`.trim()}>
      <span className="lang-switch-label">{t("lang")}</span>
      <select
        value={locale}
        aria-label={t("lang")}
        onChange={(e) => setLocale(e.target.value as Locale)}
      >
        <option value="ru">{t("langRu")}</option>
        <option value="en">{t("langEn")}</option>
      </select>
    </label>
  );
}
