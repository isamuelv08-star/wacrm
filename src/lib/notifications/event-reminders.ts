import type { SupabaseClient } from '@supabase/supabase-js'

// ============================================================
// Calendar event reminders.
//
// Every pending calendar_events row with a reminder configured
// (reminder_minutes_before) gets exactly one notification, raised
// once its start time falls inside that reminder window —
// reminder_sent_at is the dedupe marker, same idiom as
// conversations.hot_lead_last_alerted_message_at (migration 040).
//
// Invoked on a schedule via GET /api/cron/event-reminders (same
// shared-secret pattern as /api/cron/hot-lead-alerts). Best-effort
// per event — one failure must never stop the rest of the scan.
// ============================================================

const MAX_CANDIDATES_PER_SCAN = 200

export interface EventReminderScanResult {
  scanned: number
  notified: number
}

interface DueEventRow {
  id: string
  account_id: string
  assigned_to: string | null
  created_by: string | null
  contact_id: string | null
  title: string
  starts_at: string
  reminder_minutes_before: number
  contacts: { name: string | null; phone: string } | null
}

/**
 * Scans for pending, not-yet-reminded events whose start time has
 * entered their own configured reminder window and notifies whoever
 * owns them.
 */
export async function runEventReminderScan(
  db: SupabaseClient,
): Promise<EventReminderScanResult> {
  const nowIso = new Date().toISOString()

  // reminder_minutes_before varies per row, so the actual "is this
  // due yet" check happens per-candidate below rather than in SQL —
  // this just narrows to pending, unreminded, still-future events.
  const { data: candidates, error } = await db
    .from('calendar_events')
    .select(
      'id, account_id, assigned_to, created_by, contact_id, title, starts_at, reminder_minutes_before, contacts(name, phone)',
    )
    .eq('status', 'pending')
    .not('reminder_minutes_before', 'is', null)
    .is('reminder_sent_at', null)
    .gt('starts_at', nowIso)
    .limit(MAX_CANDIDATES_PER_SCAN)

  if (error) {
    console.error('[event-reminders] candidate scan failed:', error.message)
    return { scanned: 0, notified: 0 }
  }
  if (!candidates || candidates.length === 0) {
    return { scanned: 0, notified: 0 }
  }

  let notified = 0
  const now = Date.now()

  for (const event of candidates as unknown as DueEventRow[]) {
    try {
      const msUntilStart = new Date(event.starts_at).getTime() - now
      const reminderWindowMs = event.reminder_minutes_before * 60_000
      if (msUntilStart > reminderWindowMs) continue // not due yet

      // assigned_to falls back to created_by so a self-scheduled,
      // unassigned event still reminds its own author.
      const recipientProfileId = event.assigned_to ?? event.created_by
      if (!recipientProfileId) continue

      // calendar_events.assigned_to/created_by are profiles.id, but
      // notifications.user_id is an auth.users id — resolve through
      // profiles, same as migration 043 does for deals.assigned_to.
      const { data: recipientProfile, error: profileErr } = await db
        .from('profiles')
        .select('user_id')
        .eq('id', recipientProfileId)
        .maybeSingle()
      if (profileErr) {
        console.error('[event-reminders] recipient lookup failed:', profileErr.message)
        continue
      }
      if (!recipientProfile) continue // assignee's profile was removed

      const contactName = event.contacts?.name || event.contacts?.phone
      const startLabel = new Date(event.starts_at).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      })

      const { error: insertErr } = await db.from('notifications').insert({
        account_id: event.account_id,
        user_id: recipientProfile.user_id,
        type: 'event_reminder',
        contact_id: event.contact_id,
        title: event.title,
        body: contactName
          ? `${event.title} with ${contactName} at ${startLabel}`
          : `${event.title} at ${startLabel}`,
      })
      if (insertErr) {
        console.error('[event-reminders] notification insert failed:', insertErr.message)
        continue
      }

      const { error: markErr } = await db
        .from('calendar_events')
        .update({ reminder_sent_at: new Date().toISOString() })
        .eq('id', event.id)
      if (markErr) {
        console.error('[event-reminders] failed to mark event reminded:', markErr.message)
      }

      notified++
    } catch (err) {
      console.error('[event-reminders] scan failed for event', event.id, err)
    }
  }

  return { scanned: candidates.length, notified }
}
