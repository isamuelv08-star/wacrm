import { describe, it, expect } from 'vitest'
import { ceoSummaryRangeParams, parseClientRange, rangeForPresetInTimezone } from './period'

describe('ceoSummaryRangeParams / parseClientRange', () => {
  it('round-trips the exact client bounds', () => {
    const range = {
      start: new Date('2026-09-01T05:00:00Z'), // Sep 1 00:00 in UTC-5
      end: new Date('2026-10-01T05:00:00Z'),
      label: 'thisMonth' as const,
    }
    const p = ceoSummaryRangeParams(range)
    expect(parseClientRange('thisMonth', p.get('from'), p.get('to'))).toEqual(range)
  })

  it('rejects missing, invalid, inverted or absurd bounds', () => {
    expect(parseClientRange('today', null, null)).toBeNull()
    expect(parseClientRange('today', 'x', 'y')).toBeNull()
    expect(parseClientRange('today', '2026-09-02T00:00:00Z', '2026-09-01T00:00:00Z')).toBeNull()
    expect(parseClientRange('allTime', '1990-01-01T00:00:00Z', '2026-01-01T00:00:00Z')).toBeNull()
  })
})

describe('rangeForPresetInTimezone', () => {
  // 2026-09-30 21:00 in Guayaquil (UTC-5) is already Oct 1 in UTC.
  const now = new Date('2026-10-01T02:00:00Z')

  it('uses the local day, not the UTC one', () => {
    const r = rangeForPresetInTimezone('today', 'America/Guayaquil', now)
    expect(r.start.toISOString()).toBe('2026-09-30T05:00:00.000Z')
    expect(r.end.toISOString()).toBe('2026-10-01T05:00:00.000Z')
  })

  it('keeps the last evening of the month in that month', () => {
    const r = rangeForPresetInTimezone('thisMonth', 'America/Guayaquil', now)
    expect(r.start.toISOString()).toBe('2026-09-01T05:00:00.000Z')
    expect(r.end.toISOString()).toBe('2026-10-01T05:00:00.000Z')
  })

  it('starts weeks on Monday and handles year rollovers', () => {
    const w = rangeForPresetInTimezone('thisWeek', 'America/Guayaquil', now) // Wed Sep 30
    expect(w.start.toISOString()).toBe('2026-09-28T05:00:00.000Z')
    const lm = rangeForPresetInTimezone('lastMonth', 'UTC', new Date('2026-01-15T12:00:00Z'))
    expect(lm.start.toISOString()).toBe('2025-12-01T00:00:00.000Z')
  })
})
