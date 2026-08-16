/**
 * Locales the language selector offers (issue: "selector de idioma").
 * `messages/{locale}.json` must exist for each — see src/i18n/request.ts,
 * which falls back to English wholesale if a dictionary is missing.
 * Korean (`ko`) has a translated dictionary too but isn't offered in the
 * picker yet, so it's deliberately left out of this list.
 */
export const SUPPORTED_LOCALES = ["en", "es", "pt"] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: SupportedLocale = "en";

/** Cookie the language selector writes to and `src/i18n/request.ts` reads. */
export const LOCALE_COOKIE = "NEXT_LOCALE";

/** Each language's own name for itself — shown in the picker regardless
 *  of the app's current locale, same convention every native picker uses. */
export const LOCALE_LABELS: Record<SupportedLocale, string> = {
  en: "English",
  es: "Español",
  pt: "Português",
};

export function isSupportedLocale(
  value: string | undefined | null,
): value is SupportedLocale {
  return !!value && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}
