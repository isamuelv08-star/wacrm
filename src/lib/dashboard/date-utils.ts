// Centralised date helpers for the dashboard so every chart / card
// agrees on what "today", "day boundary", and "day of week" mean.
// All boundaries are computed in the user's LOCAL timezone — which is
// what a business user intuitively expects when they say "today".

export function startOfLocalDay(d: Date = new Date()): Date {
  const out = new Date(d)
  out.setHours(0, 0, 0, 0)
  return out
}

export function daysAgoStart(days: number): Date {
  const out = startOfLocalDay()
  out.setDate(out.getDate() - days)
  return out
}

/** Date-only key (YYYY-MM-DD) for bucketing rows by local calendar day. */
export function localDayKey(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Inclusive list of local-day keys spanning the last `n` days, in
 * chronological order. Useful for seeding chart buckets so days with
 * zero activity still render a 0-point in the line.
 */
export function lastNDayKeys(n: number): string[] {
  const keys: string[] = []
  const start = daysAgoStart(n - 1)
  for (let i = 0; i < n; i++) {
    const d = new Date(start)
    d.setDate(d.getDate() + i)
    keys.push(localDayKey(d))
  }
  return keys
}

/**
 * ISO day-of-week where 0 = Monday … 6 = Sunday. JavaScript's native
 * getDay() uses 0 = Sunday which is awkward for most business charts.
 */
export function mondayIndex(d: Date): number {
  const jsDow = d.getDay() // 0..6 with Sunday=0
  return (jsDow + 6) % 7
}

export const DOW_SHORT_MON_FIRST = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

/** First-of-month key (YYYY-MM-01) for a date, in local time. Matches
 *  the shape `sales_goals.period_month` is stored in, so a goal row
 *  and a bucketed deal can be joined on this string directly. */
export function monthKey(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}-01`
}

/** Start-of-month Date, `n` months before the current one (0 = this month). */
export function monthsAgoStart(n: number): Date {
  const out = startOfLocalDay()
  out.setDate(1)
  out.setMonth(out.getMonth() - n)
  return out
}

/**
 * Inclusive list of month keys spanning the last `n` months (oldest
 * first), ending with the current month — same "seed every bucket so
 * zero-activity periods still render" purpose as `lastNDayKeys`.
 */
export function lastNMonthKeys(n: number): string[] {
  const keys: string[] = []
  for (let i = n - 1; i >= 0; i--) {
    keys.push(monthKey(monthsAgoStart(i)))
  }
  return keys
}

// ------------------------------------------------------------
// Global dashboard date-range selector — a real calendar period (see
// `@/lib/period`'s `PeriodRange`), same abstraction the Pipeline
// Analytics period selector uses. Everything below supports comparing
// "the selected period" against "the equal-length period immediately
// before it", and bucketing the selected period into a
// display-friendly number of points for a trend chart — shared by
// every dashboard query that needs to respond to the range instead of
// a fixed "today" or "this month".
// ------------------------------------------------------------

export interface DateRange {
  start: Date
  /** Exclusive. */
  end: Date
}

/** The PRIOR period of equal length, immediately before `range`. */
export function previousRange(range: DateRange): DateRange {
  const durationMs = range.end.getTime() - range.start.getTime()
  return {
    start: new Date(range.start.getTime() - durationMs),
    end: new Date(range.start.getTime()),
  }
}

export interface RangeBucket {
  start: Date
  /** Exclusive. */
  end: Date
  /** Short label for a chart x-axis — the bucket's own start day. */
  label: string
}

/**
 * Splits the selected period into up to `maxBuckets` even buckets,
 * oldest first. A period spanning 30 days or fewer gets one bucket per
 * day (matches `lastNDayKeys`'s granularity); longer periods (a
 * quarter, a year, all-time) collapse into ~`maxBuckets` multi-day
 * buckets so a trend chart or sparkline never has to plot hundreds of
 * points.
 */
export function rangeBuckets(range: DateRange, maxBuckets = 30): RangeBucket[] {
  const durationMs = range.end.getTime() - range.start.getTime()
  const totalDays = Math.max(1, Math.round(durationMs / 86_400_000))
  const bucketCount = Math.max(1, Math.min(totalDays, maxBuckets))
  const buckets: RangeBucket[] = []
  for (let i = 0; i < bucketCount; i++) {
    const startOffsetMs = Math.floor((i * durationMs) / bucketCount)
    const endOffsetMs = Math.floor(((i + 1) * durationMs) / bucketCount)
    const bStart = new Date(range.start.getTime() + startOffsetMs)
    const bEnd = new Date(range.start.getTime() + endOffsetMs)
    buckets.push({ start: bStart, end: bEnd, label: shortDayLabel(bStart) })
  }
  return buckets
}

function shortDayLabel(d: Date): string {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** Number of calendar days in the month a date falls in (local time). */
export function daysInMonthOf(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
}
