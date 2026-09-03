import type { SupabaseClient } from '@supabase/supabase-js'
import { getValidAccessToken, createGoogleEvent, updateGoogleEvent, deleteGoogleEvent } from '@/lib/google-calendar/client'
import { isSyncEnabled } from '@/lib/google-calendar/connection'

// ============================================================
// Best-effort push of a `calendar_events` row to the account's
// connected Google Calendar. Shared by every write path that touches
// calendar_events: the manual Calendar page
// (src/app/api/calendar/events/*), and the AI scheduling sentinel
// (src/lib/ai/scheduling-actions.ts). Same posture as
// `applyScheduledEvent` — try/catch, never throws, a Google failure
// must never take down the caller (a WhatsApp auto-reply that already
// sent, or a save the user is waiting on in the CRM's own UI).
// ============================================================

/** Point-in-time events (no `ends_at`) get a nominal 30-minute Google
 *  event, since Google Calendar has no zero-duration event concept. */
const DEFAULT_DURATION_MS = 30 * 60 * 1000

export interface SyncableEvent {
  id: string
  title: string
  notes: string | null
  starts_at: string
  ends_at: string | null
  google_event_id: string | null
}

/**
 * Creates or updates the Google event for `event` and writes the
 * resulting `google_event_id` back onto the row. No-op (returns
 * immediately) when sync isn't enabled or there's no connection.
 */
export async function syncEventToGoogle(
  db: SupabaseClient,
  accountId: string,
  event: SyncableEvent,
): Promise<void> {
  try {
    if (!(await isSyncEnabled(db, accountId))) return
    const accessToken = await getValidAccessToken(db, accountId)
    if (!accessToken) return

    const start = event.starts_at
    const end = event.ends_at ?? new Date(new Date(event.starts_at).getTime() + DEFAULT_DURATION_MS).toISOString()
    const input = { summary: event.title, description: event.notes, start, end }

    if (event.google_event_id) {
      await updateGoogleEvent(accessToken, event.google_event_id, input)
      return
    }

    const created = await createGoogleEvent(accessToken, input)
    const { error } = await db
      .from('calendar_events')
      .update({ google_event_id: created.id })
      .eq('id', event.id)
    if (error) {
      console.error('[calendar google-sync] failed to save google_event_id:', error)
    }
  } catch (err) {
    console.error('[calendar google-sync] syncEventToGoogle failed:', err)
  }
}

/** Removes the Google event for a `calendar_events` row being deleted
 *  or cancelled. No-op when it was never synced or sync isn't enabled. */
export async function deleteEventFromGoogle(
  db: SupabaseClient,
  accountId: string,
  googleEventId: string | null,
): Promise<void> {
  if (!googleEventId) return
  try {
    if (!(await isSyncEnabled(db, accountId))) return
    const accessToken = await getValidAccessToken(db, accountId)
    if (!accessToken) return
    await deleteGoogleEvent(accessToken, googleEventId)
  } catch (err) {
    console.error('[calendar google-sync] deleteEventFromGoogle failed:', err)
  }
}
