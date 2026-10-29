import { migrateBrandStorage } from "./brand-storage";
import { useSyncExternalStore } from "react";
import en from "./locales/en.json";
import fr from "./locales/fr.json";
import es from "./locales/es.json";
import ko from "./locales/ko.json";
import ja from "./locales/ja.json";
import zh from "./locales/zh.json";

export const languages = [
  { code: "en", name: "English" },
  { code: "fr", name: "Français" },
  { code: "es", name: "Español" },
  { code: "ko", name: "한국어" },
  { code: "ja", name: "日本語" },
  { code: "zh", name: "简体中文" },
] as const;
export type Locale = (typeof languages)[number]["code"];
const catalogs: Record<Locale, Record<string, string>> = {
  en,
  fr,
  es,
  ko,
  ja,
  zh,
};
export const localeStorageKey = "dirrio.locale";

export function resolveLocale(
  value: string | null | undefined,
): Locale | undefined {
  const code = value?.toLowerCase().split(/[-_]/)[0];
  return languages.find((language) => language.code === code)?.code;
}
function initialLocale(): Locale {
  if (typeof window === "undefined") return "en";
  try {
    migrateBrandStorage(window.localStorage);
    const saved = resolveLocale(window.localStorage.getItem(localeStorageKey));
    if (saved) return saved;
  } catch {
    /* Storage may be unavailable in private or embedded browsers. */
  }
  return (
    window.navigator.languages?.map(resolveLocale).find(Boolean) ??
    resolveLocale(window.navigator.language) ??
    "en"
  );
}
let locale = initialLocale();
const listeners = new Set<() => void>();
function applyLocale() {
  if (typeof document !== "undefined") {
    document.documentElement.lang = locale === "zh" ? "zh-Hans" : locale;
    document.documentElement.dir = "ltr";
  }
}
applyLocale();
export function getLocale(): Locale {
  return locale;
}
export function setLocale(next: Locale) {
  if (!languages.some((language) => language.code === next)) return;
  try {
    window.localStorage.setItem(localeStorageKey, next);
  } catch {
    /* Keep the session preference. */
  }
  if (next === locale) return;
  locale = next;
  applyLocale();
  listeners.forEach((listener) => listener());
}
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== localeStorageKey) return;
    const next = resolveLocale(event.newValue) ?? "en";
    if (next === locale) return;
    locale = next;
    applyLocale();
    listeners.forEach((listener) => listener());
  });
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export function useLocale() {
  return useSyncExternalStore(subscribe, getLocale, () => "en" as Locale);
}
/** Source English is the fallback; interpolation uses React's normal text escaping. */
export function t(
  source: string,
  values: Record<string, string | number | undefined | null> = {},
): string {
  const catalog = catalogs[locale];
  const message = Object.prototype.hasOwnProperty.call(catalog, source)
    ? catalog[source] || source
    : source;
  return message.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key)
      ? String(values[key] ?? "")
      : match,
  );
}
/** Select the locale's plural form, rather than assuming count === 1. */
export function tn(one: string, other: string, count: number): string {
  return t(new Intl.PluralRules(locale).select(count) === "one" ? one : other, {
    count: new Intl.NumberFormat(locale).format(count),
  });
}
/** Values remain USD and retain micro-dollar precision in every locale. */
export function formatUsd(micros: number): string {
  if (!Number.isSafeInteger(micros) || micros < 0)
    throw new Error("Invalid USD amount");
  const fraction = String(micros % 1_000_000)
    .padStart(6, "0")
    .replace(/0+$/, "");
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: Math.max(2, fraction.length),
    useGrouping: locale !== "en",
  }).format(micros / 1_000_000);
}
