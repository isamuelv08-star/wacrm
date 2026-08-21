import { describe, it, expect } from 'vitest'
import { computeStalenessTier, minutesUnanswered, stalenessTierLabelKey } from './lead-staleness'

describe('computeStalenessTier', () => {
  it('is 0 (not stale) under 5 minutes', () => {
    expect(computeStalenessTier(0)).toBe(0)
    expect(computeStalenessTier(4.9)).toBe(0)
  })

  it('escalates through each boundary', () => {
    expect(computeStalenessTier(5)).toBe(1)
    expect(computeStalenessTier(14.9)).toBe(1)
    expect(computeStalenessTier(15)).toBe(2)
    expect(computeStalenessTier(29.9)).toBe(2)
    expect(computeStalenessTier(30)).toBe(3)
    expect(computeStalenessTier(59.9)).toBe(3)
    expect(computeStalenessTier(60)).toBe(4)
  })

  it('stays at the highest tier well past 1h', () => {
    expect(computeStalenessTier(500)).toBe(4)
  })
})

describe('stalenessTierLabelKey', () => {
  it('maps each tier to its i18n key', () => {
    expect(stalenessTierLabelKey(1)).toBe('tier1')
    expect(stalenessTierLabelKey(4)).toBe('tier4')
  })

  it('returns null for tier 0 / unknown tiers', () => {
    expect(stalenessTierLabelKey(0)).toBeNull()
    expect(stalenessTierLabelKey(99)).toBeNull()
  })
})

describe('minutesUnanswered', () => {
  it('is null with no message', () => {
    expect(minutesUnanswered(null, null)).toBeNull()
    expect(minutesUnanswered(undefined, 'customer')).toBeNull()
  })

  it('is null when the last message was not from the customer', () => {
    expect(minutesUnanswered('2026-01-15T09:00:00Z', 'agent')).toBeNull()
    expect(minutesUnanswered('2026-01-15T09:00:00Z', 'bot')).toBeNull()
  })

  it('computes elapsed minutes when the customer is owed a reply', () => {
    const now = new Date('2026-01-15T09:10:00Z')
    expect(minutesUnanswered('2026-01-15T09:00:00Z', 'customer', now)).toBe(10)
  })
})
