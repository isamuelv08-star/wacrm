import { isValidTimezone } from '@/lib/automations/schedule'

export { isValidTimezone }

/**
 * Human-readable "right now" in the given IANA zone, dropped into the
 * scheduling system-prompt block (see `buildSystemPrompt`'s
 * `scheduling` param) — the model reasons about relative phrases
 * ("tomorrow at 10", "in 30 minutes") against this fixed reference
 * point instead of doing any timezone conversion itself. Falls back to
 * UTC for an invalid/missing zone, same posture as
 * `isTimeBasedAutomationDue`.
 */
export function describeNowInZone(timezone: string): string {
  const tz = isValidTimezone(timezone) ? timezone : 'UTC'
  const now = new Date()
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long' }).format(now)
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now)
  return `${weekday} ${date}, ${time} (${tz})`
}

/**
 * Offset (ms) to ADD to a UTC instant to get `timezone`'s wall-clock
 * reading at that instant. Standard two-pass trick: format `date` in
 * the zone, re-interpret those same digits as if they were UTC, and
 * diff against the real UTC instant. Accurate to the minute except
 * inside the ~1h window of a DST transition, which is an acceptable
 * approximation here (same one `date-fns-tz` uses internally).
 */
function zoneOffsetMs(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date)
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0)
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24,
    get('minute'),
    get('second'),
  )
  return asUtc - date.getTime()
}

const LOCAL_DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/

/**
 * Interprets a "YYYY-MM-DDTHH:mm[:ss]" wall-clock string — with no
 * offset, since the model is only ever asked for local time in the
 * zone `describeNowInZone` showed it, never for timezone math — as a
 * moment in `timezone`, and returns the equivalent UTC ISO string.
 * Returns null for anything that doesn't match the expected shape.
 */
export function localDateTimeToUtcIso(
  localDateTime: string,
  timezone: string,
): string | null {
  const match = LOCAL_DATETIME_RE.exec(localDateTime.trim())
  if (!match) return null
  const tz = isValidTimezone(timezone) ? timezone : 'UTC'
  const [, y, mo, d, h, mi, s] = match
  const guessUtcMs = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s ?? '0'),
  )
  const offset = zoneOffsetMs(new Date(guessUtcMs), tz)
  return new Date(guessUtcMs - offset).toISOString()
}
