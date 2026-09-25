import { describe, it, expect } from 'vitest'
import { describeNowInZone, localDateTimeToUtcIso, dayKeyInTimezone } from './timezone'

describe('localDateTimeToUtcIso', () => {
  it('converts a UTC-5 local wall clock to the right UTC instant', () => {
    // America/Guayaquil is fixed UTC-5, no DST — 10:00 local is 15:00Z.
    expect(localDateTimeToUtcIso('2026-08-29T10:00', 'America/Guayaquil')).toBe(
      '2026-08-29T15:00:00.000Z',
    )
  })

  it('treats a bare local time as UTC when the zone is UTC', () => {
    expect(localDateTimeToUtcIso('2026-08-29T10:00:00', 'UTC')).toBe(
      '2026-08-29T10:00:00.000Z',
    )
  })

  it('handles a positive-offset zone', () => {
    // Asia/Tokyo is fixed UTC+9 — 10:00 local is the PREVIOUS day 01:00Z.
    expect(localDateTimeToUtcIso('2026-08-29T10:00', 'Asia/Tokyo')).toBe(
      '2026-08-29T01:00:00.000Z',
    )
  })

  it('accounts for DST on a zone that observes it', () => {
    // America/New_York is UTC-4 in August (EDT).
    expect(localDateTimeToUtcIso('2026-08-29T10:00', 'America/New_York')).toBe(
      '2026-08-29T14:00:00.000Z',
    )
  })

  it('falls back to UTC for an unrecognized zone', () => {
    expect(localDateTimeToUtcIso('2026-08-29T10:00', 'Not/AZone')).toBe(
      '2026-08-29T10:00:00.000Z',
    )
  })

  it('returns null for a value that does not match the expected shape', () => {
    expect(localDateTimeToUtcIso('tomorrow at 10am', 'UTC')).toBeNull()
    expect(localDateTimeToUtcIso('2026-08-29', 'UTC')).toBeNull()
  })
})

describe('describeNowInZone', () => {
  it('includes the zone name and falls back to UTC for an invalid one', () => {
    expect(describeNowInZone('America/Guayaquil')).toContain('(America/Guayaquil)')
    expect(describeNowInZone('Not/AZone')).toContain('(UTC)')
  })
})

describe('dayKeyInTimezone', () => {
  it('returns the local day, not the UTC day', () => {
    // 19:30 in Guayaquil (UTC-5) is already the next day in UTC.
    expect(dayKeyInTimezone('2026-09-25T00:30:00Z', 'America/Guayaquil')).toBe('2026-09-24')
    expect(dayKeyInTimezone('2026-09-25T00:30:00Z', 'UTC')).toBe('2026-09-25')
    // Seoul (UTC+9): 20:00 UTC is already tomorrow locally.
    expect(dayKeyInTimezone('2026-09-24T20:00:00Z', 'Asia/Seoul')).toBe('2026-09-25')
  })

  it('falls back to the UTC day for an invalid zone', () => {
    expect(dayKeyInTimezone('2026-09-25T00:30:00Z', 'Not/AZone')).toBe('2026-09-25')
  })
})
