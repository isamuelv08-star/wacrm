import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { DEFAULT_LOCALE, LOCALE_COOKIE, isSupportedLocale } from '@/lib/i18n/locales';

export default getRequestConfig(async () => {
  // The language selector (Header) writes NEXT_LOCALE via /api/locale;
  // that cookie wins whenever it's set to something we actually ship a
  // dictionary for. Falls back to the env var (single-locale
  // deployments that never touch the selector), then 'en'.
  const cookieLocale = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isSupportedLocale(cookieLocale)
    ? cookieLocale
    : process.env.NEXT_PUBLIC_APP_LOCALE || DEFAULT_LOCALE;

  let messages;
  try {
    messages = (await import(`../../messages/${locale}.json`)).default;
  } catch {
    // Fallback to English if the dictionary for the requested locale doesn't exist yet
    messages = (await import(`../../messages/en.json`)).default;
  }

  return {
    locale,
    messages
  };
});
