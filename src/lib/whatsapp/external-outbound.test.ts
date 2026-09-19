import { describe, expect, it } from 'vitest'
import { isMissingColumnError, isNewestMessage, sentAtIso } from './external-outbound'

describe('sentAtIso', () => {
  it('converts unix seconds (as a string, the way the adapter carries them)', () => {
    expect(sentAtIso('1789787877')).toBe(new Date(1789787877 * 1000).toISOString())
  })

  it('accepts a number too', () => {
    expect(sentAtIso(1_700_000_000)).toBe('2023-11-14T22:13:20.000Z')
  })

  it.each([undefined, null, '', 'abc', '0', 0, -5, NaN])('returns null for %s', (v) => {
    expect(sentAtIso(v as never)).toBeNull()
  })
})

describe('isNewestMessage', () => {
  const t = Date.parse('2026-09-19T12:00:00Z')

  it('is newest when the conversation has no last message yet', () => {
    expect(isNewestMessage(null, t)).toBe(true)
    expect(isNewestMessage(undefined, t)).toBe(true)
  })

  it('is newest when it is later than (or equal to) the current last message', () => {
    expect(isNewestMessage('2026-09-19T11:59:59Z', t)).toBe(true)
    expect(isNewestMessage('2026-09-19T12:00:00Z', t)).toBe(true)
  })

  it('is NOT newest when a late phone message is older than the current last one', () => {
    expect(isNewestMessage('2026-09-19T12:00:01Z', t)).toBe(false)
  })

  it('treats an unparseable previous value as "replace it"', () => {
    expect(isNewestMessage('not a date', t)).toBe(true)
  })
})

describe('isMissingColumnError', () => {
  it('recognises Postgres undefined_column and PostgREST schema-cache misses', () => {
    expect(isMissingColumnError({ code: '42703' })).toBe(true)
    expect(isMissingColumnError({ code: 'PGRST204' })).toBe(true)
  })

  it('does not swallow other errors', () => {
    expect(isMissingColumnError({ code: '23505' })).toBe(false) // unique violation
    expect(isMissingColumnError({ message: 'boom' })).toBe(false)
  })
})
