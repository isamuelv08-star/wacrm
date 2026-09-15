/**
 * Strips everything except letters, numbers, spaces, and a small set
 * of characters real names/emails/phone numbers actually use
 * (`+ @ . - _`) from a free-text search term before it gets
 * interpolated into a PostgREST `.or(...)` filter string
 * (`name.ilike.%term%,phone.ilike.%term%,...`).
 *
 * PostgREST's filter grammar isn't SQL — this can't enable SQL
 * injection — but an unescaped comma or parenthesis can still break
 * out of the intended `ilike` clause into a different filter
 * expression the caller didn't intend (filter-grammar confusion,
 * bounded to the RLS-scoped rows the caller can already see). This is
 * defense-in-depth consistency with the same whitelist already used
 * server-side in `/api/v1/contacts`.
 */
export function sanitizeOrSearchTerm(raw: string): string {
  return raw.replace(/[^\p{L}\p{N} +@.\-_]/gu, "").trim();
}
