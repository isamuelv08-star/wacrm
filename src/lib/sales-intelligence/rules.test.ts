import { describe, it, expect } from 'vitest'
import type { CeoAlerts } from '../dashboard/ceo-types'
import { buildBrokenPromiseSignal, buildSignalsFromAlerts } from './rules'

function baseAlerts(overrides: Partial<CeoAlerts> = {}): CeoAlerts {
  return {
    stalledCount: 0,
    stalledValue: 0,
    forecastGapPct: null,
    atRiskCustomerCount: 0,
    winRateDeclinePts: null,
    salesCycleIncreasePct: null,
    lowPipelineCoverage: null,
    ...overrides,
  }
}

describe('buildSignalsFromAlerts', () => {
  it('produces no signals when every check is clean', () => {
    expect(buildSignalsFromAlerts(baseAlerts())).toEqual([])
  })

  it('emits one signal per tripped check, independently', () => {
    const signals = buildSignalsFromAlerts(
      baseAlerts({ forecastGapPct: -12, atRiskCustomerCount: 3 }),
    )
    expect(signals.map((s) => s.signalType).sort()).toEqual(['at_risk_customers', 'forecast_gap'])
  })

  it('never invents a stalled_deals signal when the count is zero, even with a nonzero value', () => {
    // Defensive case: stalledValue should never be positive with a
    // zero count in practice, but the rule must key off the count.
    const signals = buildSignalsFromAlerts(baseAlerts({ stalledCount: 0, stalledValue: 5000 }))
    expect(signals).toEqual([])
  })

  it('escalates forecast_gap severity with the size of the shortfall', () => {
    const low = buildSignalsFromAlerts(baseAlerts({ forecastGapPct: -5 }))[0]
    const medium = buildSignalsFromAlerts(baseAlerts({ forecastGapPct: -15 }))[0]
    const high = buildSignalsFromAlerts(baseAlerts({ forecastGapPct: -30 }))[0]
    expect(low.severity).toBe('low')
    expect(medium.severity).toBe('medium')
    expect(high.severity).toBe('high')
  })

  it('scales stalled_deals severity by the value at risk, not the count', () => {
    const small = buildSignalsFromAlerts(baseAlerts({ stalledCount: 20, stalledValue: 500 }))[0]
    const large = buildSignalsFromAlerts(baseAlerts({ stalledCount: 1, stalledValue: 80_000 }))[0]
    expect(small.severity).toBe('low')
    expect(large.severity).toBe('high')
    expect(large.valueAtRisk).toBe(80_000)
  })

  it('carries "valor potencial afectado" framing, never "perdiste"', () => {
    const [signal] = buildSignalsFromAlerts(baseAlerts({ stalledCount: 2, stalledValue: 12_000 }))
    expect(signal.explanation.toLowerCase()).toContain('valor potencial afectado')
    expect(signal.explanation.toLowerCase()).not.toContain('perdiste')
  })

  it('leaves valueAtRisk null for signals measured in points/percent/count', () => {
    const signals = buildSignalsFromAlerts(
      baseAlerts({
        forecastGapPct: -20,
        lowPipelineCoverage: 1.2,
        winRateDeclinePts: 10,
        salesCycleIncreasePct: 30,
        atRiskCustomerCount: 5,
      }),
    )
    expect(signals.every((s) => s.valueAtRisk === null)).toBe(true)
    expect(signals).toHaveLength(5)
  })

  it('always attaches a non-empty explanation and evidence payload', () => {
    const signals = buildSignalsFromAlerts(
      baseAlerts({ forecastGapPct: -20, stalledCount: 1, stalledValue: 1000 }),
    )
    for (const s of signals) {
      expect(s.explanation.length).toBeGreaterThan(0)
      expect(Object.keys(s.evidence).length).toBeGreaterThan(0)
    }
  })
})

describe('buildBrokenPromiseSignal', () => {
  it('returns null when nothing is overdue', () => {
    expect(buildBrokenPromiseSignal(0)).toBeNull()
  })

  it('escalates severity with the overdue count', () => {
    expect(buildBrokenPromiseSignal(1)?.severity).toBe('low')
    expect(buildBrokenPromiseSignal(3)?.severity).toBe('medium')
    expect(buildBrokenPromiseSignal(6)?.severity).toBe('high')
  })

  it('leaves valueAtRisk null — a promise is not a dollar figure', () => {
    expect(buildBrokenPromiseSignal(2)?.valueAtRisk).toBeNull()
  })

  it('carries the count as metricValue and in evidence', () => {
    const signal = buildBrokenPromiseSignal(4)
    expect(signal?.metricValue).toBe(4)
    expect(signal?.evidence).toEqual({ overdueCount: 4 })
  })
})
