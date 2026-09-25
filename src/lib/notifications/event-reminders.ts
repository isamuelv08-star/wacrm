import type { SupabaseClient } from '@supabase/supabase-js'
import { sendAppointmentNotification } from '@/lib/booking/notify'
import { serverNotificationText } from '@/lib/i18n/server-text'

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

const PAGE_SIZE = 500
/** Upper bound on any configurable reminder lead time. */
const MAX_REMINDER_LOOKAHEAD_MS = 8 * 24 * 60 * 60_000

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
  type: string
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
  const now = Date.now()
  const nowIso = new Date(now).toISOString()
  const horizonIso = new Date(now + MAX_REMINDER_LOOKAHEAD_MS).toISOString()

  // reminder_minutes_before varies per row, so the actual "is this
  // due yet" check happens per-candidate below rather than in SQL —
  // this narrows to pending, unreminded events starting soon enough to
  // possibly be due, soonest first and paged (a bare LIMIT 200 with no
  // ORDER BY could keep returning far-future events and never reach
  // one that was due).
  const candidates: DueEventRow[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data: page, error } = await db
      .from('calendar_events')
      .select(
        'id, account_id, assigned_to, created_by, contact_id, title, type, starts_at, reminder_minutes_before, contacts(name, phone)',
      )
      .eq('status', 'pending')
      .not('reminder_minutes_before', 'is', null)
      .is('reminder_sent_at', null)
      .gt('starts_at', nowIso)
      .lte('starts_at', horizonIso)
      .order('starts_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
    if (error) {
      console.error('[event-reminders] candidate scan failed:', error.message)
      break
    }
    if (!page || page.length === 0) break
    candidates.push(...(page as unknown as DueEventRow[]))
    if (page.length < PAGE_SIZE) break
  }
  if (candidates.length === 0) {
    return { scanned: 0, notified: 0 }
  }

  let notified = 0

  for (const event of candidates) {
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

      // Claim the event BEFORE notifying: a conditional update that only
      // one run can win. The old order (notify, then mark) re-sent the
      // reminder — WhatsApp to the customer included — every run when
      // the mark failed, or when two runs overlapped.
      const { data: claimed, error: claimErr } = await db
        .from('calendar_events')
        .update({ reminder_sent_at: new Date().toISOString() })
        .eq('id', event.id)
        .is('reminder_sent_at', null)
        .select('id')
        .maybeSingle()
      if (claimErr) {
        console.error('[event-reminders] failed to claim event:', claimErr.message)
        continue
      }
      if (!claimed) continue // another run already sent it

      const contactName = event.contacts?.name || event.contacts?.phone
      // A relative "in N minutes" label rather than an absolute clock
      // time: this cron runs on the server (UTC on Vercel), and there
      // is no per-account/user timezone stored anywhere in this app —
      // `toLocaleTimeString()` here used to format against the SERVER's
      // timezone, so every recipient not in UTC saw a wrong wall-clock
      // time in the notification (e.g. a 9:30am local event read "at
      // 14:30"). Minutes-until-start needs no timezone at all and is
      // computed from the actual remaining time at send, not the
      // configured `reminder_minutes_before` — the cron's own polling
      // cadence means it may fire a few minutes after the window
      // opened, so the exact configured value could already overstate
      // how much time is actually left.
      const minutesLeft = Math.max(0, Math.round(msUntilStart / 60_000))
      const t = serverNotificationText()
      const timingLabel =
        minutesLeft <= 1 ? t('whenNow') : t('whenInMinutes', { minutes: minutesLeft })

      const { error: insertErr } = await db.from('notifications').insert({
        account_id: event.account_id,
        user_id: recipientProfile.user_id,
        type: 'event_reminder',
        contact_id: event.contact_id,
        title: event.title,
        body: contactName
          ? t('eventReminderWith', { title: event.title, name: contactName, when: timingLabel })
          : t('eventReminder', { title: event.title, when: timingLabel }),
      })
      if (insertErr) {
        console.error('[event-reminders] notification insert failed:', insertErr.message)
      }

      // An 'appointment' is a customer-facing commitment, unlike the
      // other event types (a call/task/follow_up is internal to the
      // business) — best-effort WhatsApp reminder alongside the staff
      // notification above, using whichever APPROVED template the
      // account picked in Settings (see notify.ts; no-ops silently if
      // none is set yet).
      if (event.type === 'appointment' && event.contacts?.phone) {
        const { data: account } = await db
          .from('accounts')
          .select('timezone')
          .eq('id', event.account_id)
          .maybeSingle()
        await sendAppointmentNotification(db, {
          accountId: event.account_id,
          contactId: event.contact_id!,
          contactName: event.contacts.name || event.contacts.phone,
          contactPhone: event.contacts.phone,
          serviceName: event.title,
          staffName: '',
          startsAt: event.starts_at,
          timezone: account?.timezone ?? 'UTC',
          kind: 'reminder',
        })
      }

      notified++
    } catch (err) {
      console.error('[event-reminders] scan failed for event', event.id, err)
    }
  }

  return { scanned: candidates.length, notified }
}
