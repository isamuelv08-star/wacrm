import type { SupabaseClient } from '@supabase/supabase-js'
import type { CalendarEventType } from '@/types'
import { localDateTimeToUtcIso } from './timezone'

// ============================================================
// Applies the [[SCHEDULE:...]] sentinel the AI auto-reply bot emitted
// this turn (see defaults.ts / generate.ts) as a `calendar_events`
// row. Same posture as sales-actions.ts / lead-scoring.ts:
// best-effort, never throws — a failure here must never take down the
// customer-facing reply that already sent.
// ============================================================

/** Advance notice on an AI-scheduled event — nobody manually reviewed
 *  or set this reminder, so it defaults on rather than off. */
const REMINDER_MINUTES_BEFORE = 30

/** A model that repeats the same commitment across turns (before a
 *  human has acted on the first one) shouldn't file it twice — skip
 *  if this contact already has a pending event within this window of
 *  the same instant. */
const DEDUPE_WINDOW_MS = 5 * 60 * 1000

/** A "commitment" that lands in the past is almost always a mis-parse
 *  rather than a real future promise — never file it. A small grace
 *  window tolerates the gap between the model naming "now" and this
 *  write landing. */
const PAST_GRACE_MS = 5 * 60 * 1000

export async function applyScheduledEvent(
  db: SupabaseClient,
  args: {
    accountId: string
    contactId: string
    /** auth.users.id of the AI config's owner. calendar_events.created_by
     *  is a FK into `profiles`, not `auth.users` (see CalendarEvent's
     *  own doc comment in src/types/index.ts), so this is resolved to
     *  a profiles.id below rather than written as-is. */
    configOwnerUserId: string
    /** Account's configured handoff agent (auth.users.id), or null —
     *  the same fixed target auto-reply hands a conversation off to,
     *  reused here so an AI-scheduled commitment lands with whoever
     *  owns follow-ups for this account instead of always sitting
     *  unassigned. Resolved to profiles.id below, same as above. */
    handoffAgentId: string | null
    timezone: string
    /** Local wall-clock "YYYY-MM-DDTHH:mm[:ss]", still in `timezone` —
     *  the raw value out of [[SCHEDULE:...]], not yet converted. */
    localDateTime: string
    type: CalendarEventType
    title: string
  },
): Promise<void> {
  const {
    accountId,
    contactId,
    configOwnerUserId,
    handoffAgentId,
    timezone,
    localDateTime,
    type,
    title,
  } = args

  try {
    const startsAt = localDateTimeToUtcIso(localDateTime, timezone)
    if (!startsAt) {
      console.warn(
        `[ai scheduling] model emitted an unparseable date "${localDateTime}" — skipping.`,
      )
      return
    }
    if (new Date(startsAt).getTime() < Date.now() - PAST_GRACE_MS) {
      console.warn(
        `[ai scheduling] model emitted a past date "${localDateTime}" (${startsAt}) — skipping.`,
      )
      return
    }

    const resolveProfileId = async (authUserId: string | null): Promise<string | null> => {
      if (!authUserId) return null
      const { data } = await db
        .from('profiles')
        .select('id')
        .eq('user_id', authUserId)
        .maybeSingle()
      return data?.id ?? null
    }

    const [createdBy, assignedTo] = await Promise.all([
      resolveProfileId(configOwnerUserId),
      resolveProfileId(handoffAgentId),
    ])

    const startMs = new Date(startsAt).getTime()
    const windowStart = new Date(startMs - DEDUPE_WINDOW_MS).toISOString()
    const windowEnd = new Date(startMs + DEDUPE_WINDOW_MS).toISOString()
    const { data: existing, error: existingErr } = await db
      .from('calendar_events')
      .select('id')
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .eq('status', 'pending')
      .gte('starts_at', windowStart)
      .lte('starts_at', windowEnd)
      .limit(1)
      .maybeSingle()
    if (existingErr) {
      console.error('[ai scheduling] dedupe lookup failed:', existingErr.message)
      return
    }
    if (existing) return

    const { error: insertErr } = await db.from('calendar_events').insert({
      account_id: accountId,
      created_by: createdBy,
      assigned_to: assignedTo,
      contact_id: contactId,
      deal_id: null,
      type,
      title: title.slice(0, 200),
      notes: 'Auto-scheduled by the AI assistant from the conversation.',
      starts_at: startsAt,
      ends_at: null,
      reminder_minutes_before: REMINDER_MINUTES_BEFORE,
    })
    if (insertErr) {
      console.error('[ai scheduling] failed to insert calendar event:', insertErr.message)
    }
  } catch (err) {
    console.error('[ai scheduling] applyScheduledEvent failed:', err)
  }
}
