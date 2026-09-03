import type { SupabaseClient } from '@supabase/supabase-js'
import { getValidAccessToken, listUpcomingEvents } from '@/lib/google-calendar/client'

// ============================================================
// Formats the account's upcoming Google Calendar events as short
// reference lines for `buildSystemPrompt`'s `calendarContext` param
// (auto-reply only, gated by `ai_scheduling_enabled` AND
// `google_calendar_sync_enabled` — see auto-reply.ts's call site).
// Best-effort: a Google outage should degrade to "no calendar
// context" for this turn, never break the reply.
// ============================================================

/** How far ahead to look. Long enough to catch "next week" commitments,
 *  short enough that the prompt doesn't balloon on a busy calendar. */
const LOOKAHEAD_DAYS = 14
const MAX_LINES = 20

export async function buildCalendarContext(
  db: SupabaseClient,
  accountId: string,
  timezone: string,
): Promise<string[]> {
  try {
    const accessToken = await getValidAccessToken(db, accountId)
    if (!accessToken) return []

    const now = new Date()
    const until = new Date(now.getTime() + LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000)
    const events = await listUpcomingEvents(accessToken, now, until)

    return events
      .filter((ev) => ev.start?.dateTime)
      .slice(0, MAX_LINES)
      .map((ev) => {
        const start = new Date(ev.start!.dateTime!).toLocaleString('en-US', {
          timeZone: timezone,
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
        return `${start}: ${ev.summary || '(untitled)'}`
      })
  } catch (err) {
    console.error('[ai calendar-context] failed to load upcoming events:', err)
    return []
  }
}
