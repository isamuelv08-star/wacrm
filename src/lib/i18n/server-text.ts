import { createTranslator } from 'next-intl'
import en from '../../../messages/en.json'
import es from '../../../messages/es.json'
import pt from '../../../messages/pt.json'
import ko from '../../../messages/ko.json'

const DICTIONARIES = { en, es, pt, ko } as const
type DictionaryLocale = keyof typeof DICTIONARIES

/**
 * Translator for text generated on the server with no request (and so
 * no user cookie) behind it — cron notifications, AI alerts. Uses the
 * deployment's configured locale (NEXT_PUBLIC_APP_LOCALE), the same
 * fallback src/i18n/request.ts uses when a user never picked one.
 * These notifications used to be hard-coded English inside an
 * otherwise Spanish app.
 */
export function serverNotificationText() {
  const configured = process.env.NEXT_PUBLIC_APP_LOCALE
  const locale: DictionaryLocale =
    configured && configured in DICTIONARIES ? (configured as DictionaryLocale) : 'en'
  return createTranslator({
    locale,
    messages: DICTIONARIES[locale],
    namespace: 'ServerNotifications',
  })
}
