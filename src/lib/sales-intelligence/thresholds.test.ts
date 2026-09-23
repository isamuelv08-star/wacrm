import { describe, expect, it } from 'vitest'
import { severityFromThresholds, severityFromInvertedThresholds } from './thresholds'

describe('severityFromThresholds', () => {
  const t = { high: 20, medium: 10 }

  it('returns high at or above the high bound', () => {
    expect(severityFromThresholds(20, t)).toBe('high')
    expect(severityFromThresholds(30, t)).toBe('high')
  })

  it('returns medium at or above the medium bound but below high', () => {
    expect(severityFromThresholds(10, t)).toBe('medium')
    expect(severityFromThresholds(19, t)).toBe('medium')
  })

  it('returns low below the medium bound', () => {
    expect(severityFromThresholds(0, t)).toBe('low')
    expect(severityFromThresholds(9.9, t)).toBe('low')
  })
})

describe('severityFromInvertedThresholds', () => {
  const t = { high: 1.5, medium: 2.25 }

  it('returns high when the value is below the high bound (smaller is worse)', () => {
    expect(severityFromInvertedThresholds(1, t)).toBe('high')
    expect(severityFromInvertedThresholds(0, t)).toBe('high')
  })

  it('returns medium between the two bounds', () => {
    expect(severityFromInvertedThresholds(1.5, t)).toBe('medium')
    expect(severityFromInvertedThresholds(2, t)).toBe('medium')
  })

  it('returns low at or above the medium bound', () => {
    expect(severityFromInvertedThresholds(2.25, t)).toBe('low')
    expect(severityFromInvertedThresholds(5, t)).toBe('low')
  })
})
