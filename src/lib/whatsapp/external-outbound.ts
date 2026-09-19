/**
 * Pure helpers for recording a WhatsApp message the business sent from
 * OUTSIDE the CRM (the WhatsApp Business phone app) — see
 * recordExternalOutboundMessage in webhook-processor.ts.
 */

/** The moment a message was really sent, as an ISO string, from the unix
 *  seconds the webhook adapter carries; null when missing or nonsensical.
 *  A phone message can be delivered late, so this — not "now" — is what
 *  the thread order and the "last message" time must use. */
export function sentAtIso(unixSeconds: string | number | null | undefined): string | null {
  const ms = Number(unixSeconds) * 1000
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null
}

/** Whether a message sent at `thisMs` should become the conversation's
 *  "last message", given the conversation's current `last_message_at`.
 *  A late-arriving older message must not drag the preview backwards. */
export function isNewestMessage(
  previousLastMessageAt: string | null | undefined,
  thisMs: number,
): boolean {
  if (!previousLastMessageAt) return true
  const previous = Date.parse(previousLastMessageAt)
  return !Number.isFinite(previous) || thisMs >= previous
}

/** Postgres 42703 (undefined_column) or PostgREST PGRST204 (column not in
 *  the schema cache) — i.e. a migration that hasn't been applied yet. */
export function isMissingColumnError(error: { code?: string; message?: string }): boolean {
  return error.code === '42703' || error.code === 'PGRST204'
}
