import type { SupabaseClient } from '@supabase/supabase-js'
import { localDateTimeToUtcIso } from '@/lib/ai/timezone'
import { isValidTimezone } from '@/lib/automations/schedule'

// ============================================================
// Open-slot computation for the public booking flow (migration 079).
//
// Given a service + a calendar date, works out every start time a
// customer could book: staff eligible for the service, each one's
// weekly working hours (staff_availability) overridden by any one-off
// exception for that date (staff_availability_exceptions), minus
// whatever that staff member is already booked for (calendar_events,
// status='pending'), with the booking page's buffer and minimum-notice
// rules applied.
//
// Callers MUST pass the service-role client (src/lib/booking/admin-client.ts)
// — this reads across every staff member's calendar_events, which the
// RLS-scoped client can't do for an unauthenticated visitor.
// ============================================================

/** Candidate start times are tried on this grid. Calendly-style tools
 *  default to something in the 15–30 minute range; 15 gives businesses
 *  with short services (e.g. a 20-minute treatment) more usable starts
 *  without the list becoming absurdly long. */
const SLOT_STEP_MINUTES = 15

export interface AvailableSlot {
  /** UTC ISO instant. */
  startsAt: string
  endsAt: string
  /** profiles.id of the staff member this slot is for. */
  profileId: string
}

export interface ComputeSlotsArgs {
  db: SupabaseClient
  accountId: string
  serviceId: string
  durationMinutes: number
  /** Restrict to these staff (booking_page_staff), or null/empty to
   *  derive eligibility from service_staff (falling further back to
   *  every agent+ account member if the service has no service_staff
   *  rows at all — see resolveEligibleStaff below). */
  staffProfileIds: string[] | null
  timezone: string
  bufferMinutes: number
  minNoticeHours: number
  /** Local calendar date to compute slots for, "YYYY-MM-DD". */
  date: string
}

interface AvailabilityRuleRow {
  profile_id: string
  weekday: number
  start_time: string
  end_time: string
}

interface ExceptionRow {
  profile_id: string
  is_available: boolean
  start_time: string | null
  end_time: string | null
}

interface BusyEventRow {
  assigned_to: string
  starts_at: string
  ends_at: string | null
}

/** Pure calendar weekday for a "YYYY-MM-DD" string (0=Sun..6=Sat) —
 *  computed via Date.UTC so it never shifts with the server's own
 *  timezone (a plain calendar date has no timezone of its own). */
function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60)
    .toString()
    .padStart(2, '0')
  const m = (minutes % 60).toString().padStart(2, '0')
  return `${h}:${m}`
}

/** Staff eligible to perform `serviceId`, narrowed to `restrictTo` when
 *  given. Falls back through service_staff, then to every agent+
 *  account member — see the migration's header note on why an empty
 *  service_staff table means "anyone can do it" rather than "no one
 *  can." */
async function resolveEligibleStaff(
  db: SupabaseClient,
  accountId: string,
  serviceId: string,
  restrictTo: string[] | null,
): Promise<string[]> {
  if (restrictTo && restrictTo.length > 0) return restrictTo

  const { data: serviceStaff } = await db
    .from('service_staff')
    .select('profile_id')
    .eq('service_id', serviceId)
  if (serviceStaff && serviceStaff.length > 0) {
    return serviceStaff.map((r) => r.profile_id as string)
  }

  const { data: members } = await db
    .from('profiles')
    .select('id')
    .eq('account_id', accountId)
    .in('account_role', ['owner', 'admin', 'agent'])
  return (members ?? []).map((r) => r.id as string)
}

export async function computeAvailableSlots(
  args: ComputeSlotsArgs,
): Promise<AvailableSlot[]> {
  const {
    db,
    accountId,
    serviceId,
    durationMinutes,
    staffProfileIds,
    bufferMinutes,
    minNoticeHours,
    date,
  } = args
  const timezone = isValidTimezone(args.timezone) ? args.timezone : 'UTC'

  const eligibleStaff = await resolveEligibleStaff(db, accountId, serviceId, staffProfileIds)
  if (eligibleStaff.length === 0) return []

  const weekday = weekdayOf(date)
  const dayStartUtc = localDateTimeToUtcIso(`${date}T00:00:00`, timezone)
  const dayEndUtc = localDateTimeToUtcIso(`${date}T23:59:59`, timezone)
  if (!dayStartUtc || !dayEndUtc) return []

  const [rulesRes, exceptionsRes, busyRes] = await Promise.all([
    db
      .from('staff_availability')
      .select('profile_id, weekday, start_time, end_time')
      .in('profile_id', eligibleStaff)
      .eq('weekday', weekday),
    db
      .from('staff_availability_exceptions')
      .select('profile_id, is_available, start_time, end_time')
      .in('profile_id', eligibleStaff)
      .eq('date', date),
    db
      .from('calendar_events')
      .select('assigned_to, starts_at, ends_at')
      .in('assigned_to', eligibleStaff)
      .eq('status', 'pending')
      .gte('starts_at', dayStartUtc)
      .lte('starts_at', dayEndUtc),
  ])

  const rules = (rulesRes.data ?? []) as AvailabilityRuleRow[]
  const exceptions = (exceptionsRes.data ?? []) as ExceptionRow[]
  const busyEvents = (busyRes.data ?? []) as BusyEventRow[]

  const exceptionByStaff = new Map(exceptions.map((e) => [e.profile_id, e]))
  const now = Date.now()
  const noticeMs = minNoticeHours * 60 * 60 * 1000
  const slots: AvailableSlot[] = []

  for (const profileId of eligibleStaff) {
    const exception = exceptionByStaff.get(profileId)

    // Working windows (local minutes-of-day) for this staff on this date.
    let windows: Array<{ start: number; end: number }>
    if (exception) {
      if (!exception.is_available) continue // explicit day off
      if (!exception.start_time || !exception.end_time) continue
      windows = [
        { start: timeToMinutes(exception.start_time), end: timeToMinutes(exception.end_time) },
      ]
    } else {
      const dayRules = rules.filter((r) => r.profile_id === profileId)
      if (dayRules.length === 0) continue // doesn't work this weekday
      windows = dayRules.map((r) => ({
        start: timeToMinutes(r.start_time),
        end: timeToMinutes(r.end_time),
      }))
    }

    const staffBusy = busyEvents
      .filter((e) => e.assigned_to === profileId)
      .map((e) => ({
        start: new Date(e.starts_at).getTime() - bufferMinutes * 60_000,
        end: (e.ends_at ? new Date(e.ends_at).getTime() : new Date(e.starts_at).getTime()) +
          bufferMinutes * 60_000,
      }))

    for (const window of windows) {
      for (
        let candidateStart = window.start;
        candidateStart + durationMinutes <= window.end;
        candidateStart += SLOT_STEP_MINUTES
      ) {
        const localStart = `${date}T${minutesToTime(candidateStart)}:00`
        const startsAt = localDateTimeToUtcIso(localStart, timezone)
        if (!startsAt) continue

        const startMs = new Date(startsAt).getTime()
        if (startMs < now + noticeMs) continue

        const endMs = startMs + durationMinutes * 60_000
        const overlaps = staffBusy.some((b) => startMs < b.end && endMs > b.start)
        if (overlaps) continue

        slots.push({
          startsAt,
          endsAt: new Date(endMs).toISOString(),
          profileId,
        })
      }
    }
  }

  return slots.sort((a, b) => a.startsAt.localeCompare(b.startsAt))
}
