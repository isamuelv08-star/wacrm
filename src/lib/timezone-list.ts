/**
 * Full IANA timezone list for the account-settings picker (AI
 * scheduling, migration 065). `Intl.supportedValuesOf` ships in every
 * runtime this app targets (Node 18+, evergreen browsers) — no
 * curated/partial list to maintain, and no dependency.
 */
export function listTimezones(): string[] {
  try {
    if (typeof Intl.supportedValuesOf === 'function') {
      return Intl.supportedValuesOf('timeZone')
    }
  } catch {
    // Fall through to the UTC-only fallback below.
  }
  return ['UTC']
}
