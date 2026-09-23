import { describe, expect, it } from 'vitest'
import { bestImprovingSeller, biggestStageLeak, computeStageDropoffs, worstDecliningSeller } from './breakdown'
import type { FunnelStep } from '@/lib/dashboard/ceo-types'
import type { SellerPeriodPerformance } from '@/lib/dashboard/ceo-queries'

const step = (over: Partial<FunnelStep>): FunnelStep => ({
  key: 'leads',
  label: 'Leads',
  count: 0,
  value: null,
  ...over,
})

describe('computeStageDropoffs', () => {
  it('pairs each adjacent step and computes a drop percent', () => {
    const steps = [step({ key: 'leads', label: 'Leads', count: 100 }), step({ key: 'won', label: 'Ganados', count: 20 })]
    const drops = computeStageDropoffs(steps)
    expect(drops).toHaveLength(1)
    expect(drops[0].dropPct).toBeCloseTo(80, 5)
  })

  it('returns an empty array for a single-step funnel', () => {
    expect(computeStageDropoffs([step({ count: 10 })])).toEqual([])
  })

  it('returns null dropPct (never divide by zero) for an empty origin stage', () => {
    const steps = [step({ key: 'leads', count: 0 }), step({ key: 'won', count: 0 })]
    expect(computeStageDropoffs(steps)[0].dropPct).toBeNull()
  })

  it('resolves the synthetic leads/won steps to real labels, never an empty string (regression: loadSalesFunnel leaves label: "" on those two by design)', () => {
    const steps = [
      step({ key: 'leads', label: '', count: 50 }),
      step({ key: 'stage-1', label: 'Seguimiento', count: 30 }),
      step({ key: 'won', label: '', count: 5 }),
    ]
    const drops = computeStageDropoffs(steps)
    expect(drops[0].fromLabel).toBe('Leads')
    expect(drops[0].toLabel).toBe('Seguimiento')
    expect(drops[1].fromLabel).toBe('Seguimiento')
    expect(drops[1].toLabel).toBe('Ganadas')
    for (const d of drops) {
      expect(d.fromLabel).not.toBe('')
      expect(d.toLabel).not.toBe('')
    }
  })

  it('falls back to "Sin etapa" for a real (non-synthetic) stage with a blank name, never a blank label', () => {
    const steps = [step({ key: 'stage-x', label: '', count: 10 }), step({ key: 'won', label: '', count: 2 })]
    const drops = computeStageDropoffs(steps)
    expect(drops[0].fromLabel).toBe('Sin etapa')
  })
})

describe('biggestStageLeak', () => {
  it('picks the transition with the highest drop percent', () => {
    const steps = [
      step({ key: 'leads', label: 'Leads', count: 100 }),
      step({ key: 'qualified', label: 'Calificados', count: 90 }), // 10% drop
      step({ key: 'won', label: 'Ganados', count: 9 }), // 90% drop
    ]
    const worst = biggestStageLeak(computeStageDropoffs(steps))
    expect(worst?.fromKey).toBe('qualified')
    expect(worst?.toKey).toBe('won')
  })

  it('returns null when nothing is comparable', () => {
    expect(biggestStageLeak([])).toBeNull()
  })
})

const seller = (over: Partial<SellerPeriodPerformance>): SellerPeriodPerformance => ({
  userId: 'u1',
  name: 'Vendedor',
  dealsWonCurrent: 0,
  dealsWonPrevious: 0,
  dealsLostCurrent: 0,
  dealsLostPrevious: 0,
  winRateCurrent: null,
  winRatePrevious: null,
  valueWonCurrent: 0,
  valueWonPrevious: 0,
  avgTicketCurrent: 0,
  avgTicketPrevious: 0,
  ...over,
})

describe('worstDecliningSeller', () => {
  it('picks the seller with the largest negative win-rate delta', () => {
    const sellers = [
      seller({ userId: 'a', winRateCurrent: 80, winRatePrevious: 75 }), // +5
      seller({ userId: 'b', winRateCurrent: 30, winRatePrevious: 60 }), // -30
      seller({ userId: 'c', winRateCurrent: 40, winRatePrevious: 50 }), // -10
    ]
    const worst = worstDecliningSeller(sellers)
    expect(worst?.userId).toBe('b')
    expect(worst?.winRateDeltaPts).toBeCloseTo(-30, 5)
  })

  it('ignores members with no rate on one side of the comparison', () => {
    const sellers = [seller({ userId: 'a', winRateCurrent: null, winRatePrevious: 60 })]
    expect(worstDecliningSeller(sellers)).toBeNull()
  })

  it('returns null when the biggest mover is actually an improvement', () => {
    const sellers = [seller({ userId: 'a', winRateCurrent: 90, winRatePrevious: 80 })]
    expect(worstDecliningSeller(sellers)).toBeNull()
  })
})

describe('bestImprovingSeller', () => {
  it('picks the seller with the largest positive win-rate delta', () => {
    const sellers = [
      seller({ userId: 'a', winRateCurrent: 60, winRatePrevious: 55 }), // +5
      seller({ userId: 'b', winRateCurrent: 90, winRatePrevious: 50 }), // +40
      seller({ userId: 'c', winRateCurrent: 40, winRatePrevious: 50 }), // -10
    ]
    const best = bestImprovingSeller(sellers)
    expect(best?.userId).toBe('b')
    expect(best?.winRateDeltaPts).toBeCloseTo(40, 5)
  })

  it('ignores members with no rate on one side of the comparison', () => {
    const sellers = [seller({ userId: 'a', winRateCurrent: 60, winRatePrevious: null })]
    expect(bestImprovingSeller(sellers)).toBeNull()
  })

  it('returns null when the biggest mover is actually a decline', () => {
    const sellers = [seller({ userId: 'a', winRateCurrent: 40, winRatePrevious: 60 })]
    expect(bestImprovingSeller(sellers)).toBeNull()
  })
})
