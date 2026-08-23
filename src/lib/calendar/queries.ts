import type { SupabaseClient } from '@supabase/supabase-js'
import type { CalendarEvent, CalendarEventType } from '@/types'

// ------------------------------------------------------------
// Client-side calendar queries. RLS scopes every query to the
// caller's account automatically (is_account_member), so nothing
// here passes account_id explicitly — same posture as
// ./dashboard/queries.ts.
// ------------------------------------------------------------

type DB = SupabaseClient

export interface CalendarEventInput {
  type: CalendarEventType
  title: string
  notes: string | null
  /** ISO timestamp. */
  startsAt: string
  /** ISO timestamp, or null for a point-in-time event with no duration. */
  endsAt: string | null
  contactId: string | null
  dealId: string | null
  /** profiles.id of whoever owns this task — null means unassigned. */
  assignedTo: string | null
  /** Minutes before `startsAt` to raise a reminder notification, or
   *  null for no reminder. */
  reminderMinutesBefore: number | null
}

// `contact`/`deal` are safe to embed directly (one FK each to their
// target table). `assignee` is deliberately NOT embedded here — this
// table has two FKs into profiles (created_by, assigned_to), and
// resolving names for a handful of team members is cheaper done once
// client-side (see event-form-dialog.tsx's own profiles fetch,
// mirroring deal-form.tsx) than fighting PostgREST's relationship
// disambiguation syntax for a set that rarely exceeds a dozen rows.
const EVENT_SELECT = '*, contact:contacts(id, name, phone), deal:deals(id, title)'

export async function loadEventsInRange(
  db: DB,
  rangeStart: Date,
  rangeEnd: Date,
): Promise<CalendarEvent[]> {
  const { data, error } = await db
    .from('calendar_events')
    .select(EVENT_SELECT)
    .gte('starts_at', rangeStart.toISOString())
    .lt('starts_at', rangeEnd.toISOString())
    .order('starts_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as unknown as CalendarEvent[]
}

export async function createEvent(
  db: DB,
  accountId: string,
  createdBy: string | null,
  input: CalendarEventInput,
) {
  return db.from('calendar_events').insert({
    account_id: accountId,
    created_by: createdBy,
    assigned_to: input.assignedTo,
    contact_id: input.contactId,
    deal_id: input.dealId,
    type: input.type,
    title: input.title,
    notes: input.notes,
    starts_at: input.startsAt,
    ends_at: input.endsAt,
    reminder_minutes_before: input.reminderMinutesBefore,
  })
}

export async function updateEvent(db: DB, id: string, input: CalendarEventInput) {
  return db
    .from('calendar_events')
    .update({
      assigned_to: input.assignedTo,
      contact_id: input.contactId,
      deal_id: input.dealId,
      type: input.type,
      title: input.title,
      notes: input.notes,
      starts_at: input.startsAt,
      ends_at: input.endsAt,
      reminder_minutes_before: input.reminderMinutesBefore,
      // Editing a still-pending reminder's timing should re-arm it —
      // otherwise moving an event later than its original reminder
      // window would leave it silently un-reminded.
      reminder_sent_at: null,
    })
    .eq('id', id)
}

export async function completeEvent(db: DB, id: string) {
  return db
    .from('calendar_events')
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('id', id)
}

export async function cancelEvent(db: DB, id: string) {
  return db.from('calendar_events').update({ status: 'cancelled' }).eq('id', id)
}

export async function reopenEvent(db: DB, id: string) {
  return db
    .from('calendar_events')
    .update({ status: 'pending', completed_at: null })
    .eq('id', id)
}

export async function deleteEvent(db: DB, id: string) {
  return db.from('calendar_events').delete().eq('id', id)
}
