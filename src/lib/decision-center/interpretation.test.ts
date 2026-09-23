import { describe, expect, it } from 'vitest'
import {
  buildDeterministicInterpretation,
  buildInterpretationEvidence,
  buildInterpretationRecommendation,
  parseInterpretationResponse,
  pickHeadlineEvidence,
  type InterpretationContext,
} from './interpretation'
import type { DecisionCenterKpis } from './types'

const kpis = (over: Partial<DecisionCenterKpis> = {}): DecisionCenterKpis => ({
  sales: { current: 1000, previous: 800 },
  leads: { current: 20, previous: 20 },
  conversion: { current: 30, previous: 40 },
  avgTicket: { current: 100, previous: 100 },
  opportunities: { current: 5, previous: 5 },
  ...over,
})

const ctx = (over: Partial<InterpretationContext> = {}): InterpretationContext => ({
  moneyAtRiskValue: 0,
  moneyAtRiskCount: 0,
  staleDays: 7,
  biggestLeakStage: null,
  currency: 'USD',
  ...over,
})

describe('buildInterpretationEvidence', () => {
  it('computes percent deltas for money/count metrics and point deltas for conversion', () => {
    const evidence = buildInterpretationEvidence(kpis())
    const sales = evidence.find((m) => m.key === 'sales')!
    const conversion = evidence.find((m) => m.key === 'conversion')!
    expect(sales.deltaKind).toBe('percent')
    expect(sales.delta).toBeCloseTo(25, 5) // (1000-800)/800 * 100
    expect(sales.direction).toBe('up')
    expect(conversion.deltaKind).toBe('points')
    expect(conversion.delta).toBeCloseTo(-10, 5) // 30 - 40
    expect(conversion.direction).toBe('down')
  })

  it('returns null delta (never a fake +100%) when the previous period had zero', () => {
    const evidence = buildInterpretationEvidence(kpis({ sales: { current: 500, previous: 0 } }))
    const sales = evidence.find((m) => m.key === 'sales')!
    expect(sales.delta).toBeNull()
    expect(sales.direction).toBe('unknown')
  })

  it('marks a metric flat when it did not meaningfully move', () => {
    const evidence = buildInterpretationEvidence(kpis())
    const leads = evidence.find((m) => m.key === 'leads')!
    const avgTicket = evidence.find((m) => m.key === 'avgTicket')!
    expect(leads.direction).toBe('flat')
    expect(avgTicket.direction).toBe('flat')
  })
})

describe('pickHeadlineEvidence', () => {
  it('never cites a flat or uncomparable metric', () => {
    const evidence = buildInterpretationEvidence(kpis())
    const picked = pickHeadlineEvidence(evidence, 5)
    expect(picked.every((m) => m.direction === 'up' || m.direction === 'down')).toBe(true)
  })

  it('orders by magnitude of change, largest first', () => {
    const evidence = buildInterpretationEvidence(
      kpis({
        sales: { current: 1100, previous: 1000 }, // +10%
        opportunities: { current: 2, previous: 10 }, // -80%
      }),
    )
    const picked = pickHeadlineEvidence(evidence, 2)
    expect(picked[0].key).toBe('opportunities')
  })
})

describe('conversion: real 0% vs. no data are never treated the same', () => {
  it('cites a real 0% conversion as a genuine decline, not a structural zero / no-data case', () => {
    // A real denominator existed (previous 40%), current genuinely
    // collapsed to 0% — this IS a real data point, distinct from "no
    // comparison available" (which buildInterpretationEvidence already
    // represents as `current: null`, never `current: 0`).
    const evidence = buildInterpretationEvidence(kpis({ conversion: { current: 0, previous: 40 } }))
    const conversion = evidence.find((m) => m.key === 'conversion')!
    expect(conversion.current).toBe(0)
    expect(conversion.direction).toBe('down')
    const text = buildDeterministicInterpretation(evidence, 'last7Days', ctx())
    expect(text).toContain('conversión bajó 40.0 puntos')
    // Never gets the "no hubo X" structural-zero treatment sales/leads/
    // avgTicket/opportunities get — a 0% rate is a real answer, not an
    // absence of data.
    expect(text).not.toMatch(/no hubo|sin datos/i)
  })

  it('represents "no comparison available" as a null current, never a fake 0%', () => {
    // loadPeriodCommercialTrend (ceo-queries.ts) returns null, not 0,
    // when there were zero closed deals to compute a rate from — this
    // just confirms buildInterpretationEvidence preserves that null
    // instead of coercing it to 0.
    const evidence = buildInterpretationEvidence(kpis({ conversion: { current: null, previous: null } }))
    const conversion = evidence.find((m) => m.key === 'conversion')!
    expect(conversion.current).toBeNull()
    expect(conversion.direction).toBe('unknown')
  })
})

describe('buildDeterministicInterpretation', () => {
  it('leads with the single worst-declining metric', () => {
    const evidence = buildInterpretationEvidence(kpis())
    const text = buildDeterministicInterpretation(evidence, 'last7Days', ctx())
    expect(text).toContain('conversión bajó 10.0 puntos')
  })

  it('falls back to a "not enough data" sentence when nothing is comparable', () => {
    const evidence = buildInterpretationEvidence(
      kpis({
        sales: { current: 0, previous: 0 },
        leads: { current: 0, previous: 0 },
        conversion: { current: null, previous: null },
        avgTicket: { current: 0, previous: 0 },
        opportunities: { current: 0, previous: 0 },
      }),
    )
    const text = buildDeterministicInterpretation(evidence, 'today', ctx())
    expect(text).toMatch(/No hay suficientes datos/)
  })

  it('falls back to the custom range phrase for an unknown preset label', () => {
    const evidence = buildInterpretationEvidence(kpis())
    // @ts-expect-error deliberately passing a value outside PeriodPreset to exercise the fallback
    const text = buildDeterministicInterpretation(evidence, 'not-a-real-preset', ctx())
    expect(text).toMatch(/^En el período seleccionado/)
  })

  it('never says a metric "bajó 100%" when it hit a structural zero — explains no sales happened instead', () => {
    const evidence = buildInterpretationEvidence(kpis({ sales: { current: 0, previous: 800 } }))
    const text = buildDeterministicInterpretation(evidence, 'last7Days', ctx())
    expect(text).not.toMatch(/ventas bajó 100\.0%/)
    expect(text).toContain('No hubo ventas en el período.')
    expect(text).toContain('$800')
  })

  it('explains a structural zero for avgTicket as "sin ticket que calcular", not a misleading percent', () => {
    const evidence = buildInterpretationEvidence(kpis({ avgTicket: { current: 0, previous: 250 } }))
    const text = buildDeterministicInterpretation(evidence, 'last7Days', ctx())
    expect(text).not.toMatch(/ticket promedio bajó 100\.0%/)
    expect(text).toMatch(/sin ticket promedio|no hay ticket promedio/i)
  })

  it('cites the real funnel leak stage when the drop is significant', () => {
    const evidence = buildInterpretationEvidence(kpis({ sales: { current: 500, previous: 1000 } }))
    const text = buildDeterministicInterpretation(
      evidence,
      'last7Days',
      ctx({ biggestLeakStage: { fromLabel: 'Seguimiento', toLabel: 'Ganadas', dropPct: 90 } }),
    )
    expect(text).toContain('"Seguimiento"')
    expect(text).toContain('"Ganadas"')
  })

  it('never cites a funnel leak below the significance threshold', () => {
    const evidence = buildInterpretationEvidence(kpis({ sales: { current: 500, previous: 1000 } }))
    const text = buildDeterministicInterpretation(
      evidence,
      'last7Days',
      ctx({ biggestLeakStage: { fromLabel: 'Seguimiento', toLabel: 'Ganadas', dropPct: 5 } }),
    )
    expect(text).not.toContain('Seguimiento')
  })

  it('uses correlational language ("coincide con"), never a causal claim, when citing stalled money', () => {
    const evidence = buildInterpretationEvidence(kpis({ sales: { current: 500, previous: 1000 } }))
    const text = buildDeterministicInterpretation(
      evidence,
      'last7Days',
      ctx({ moneyAtRiskValue: 4060, moneyAtRiskCount: 12 }),
    )
    expect(text).toContain('coincide con')
    expect(text).toMatch(/[,.]060/)
    expect(text).toContain('12')
    expect(text).not.toMatch(/porque|debido a/)
  })

  it('never mentions stalled money when there is none', () => {
    const evidence = buildInterpretationEvidence(kpis({ sales: { current: 500, previous: 1000 } }))
    const text = buildDeterministicInterpretation(evidence, 'last7Days', ctx({ moneyAtRiskCount: 0 }))
    expect(text).not.toContain('coincide con')
  })
})

describe('buildInterpretationRecommendation', () => {
  it('cites the real stalled count/value/window when money is at risk, not a generic message', () => {
    const evidence = buildInterpretationEvidence(kpis({ conversion: { current: 10, previous: 40 } }))
    const rec = buildInterpretationRecommendation(evidence, ctx({ moneyAtRiskValue: 4060, moneyAtRiskCount: 12, staleDays: 7 }))
    expect(rec?.description).toContain('12 oportunidades')
    expect(rec?.description).toContain('7 días')
    expect(rec?.description).toMatch(/[,.]060/)
  })

  it('falls back to the per-metric message when there is no stalled money', () => {
    const evidence = buildInterpretationEvidence(kpis({ conversion: { current: 10, previous: 40 } }))
    const rec = buildInterpretationRecommendation(evidence, ctx())
    expect(rec?.title).toBe('Revisa el manejo de las conversaciones')
  })

  it('picks the sales recommendation when sales fell the most and there is no stalled money', () => {
    const evidence = buildInterpretationEvidence(kpis({ sales: { current: 100, previous: 1000 } }))
    const rec = buildInterpretationRecommendation(evidence, ctx())
    expect(rec?.title).toBe('Revisa por qué no se está cerrando')
  })

  it('falls back to a positive framing when nothing declined but something improved', () => {
    const evidence = buildInterpretationEvidence(
      kpis({
        sales: { current: 1200, previous: 1000 },
        leads: { current: 20, previous: 20 },
        conversion: { current: 30, previous: 30 },
        avgTicket: { current: 100, previous: 100 },
        opportunities: { current: 5, previous: 5 },
      }),
    )
    const rec = buildInterpretationRecommendation(evidence, ctx())
    expect(rec?.title).toBe('Sigue con el enfoque actual')
  })

  it('returns null when nothing moved at all', () => {
    const evidence = buildInterpretationEvidence(
      kpis({
        sales: { current: 1000, previous: 1000 },
        leads: { current: 20, previous: 20 },
        conversion: { current: 30, previous: 30 },
        avgTicket: { current: 100, previous: 100 },
        opportunities: { current: 5, previous: 5 },
      }),
    )
    expect(buildInterpretationRecommendation(evidence, ctx())).toBeNull()
  })

  it('never invents a recommendation for a metric with no comparison data', () => {
    const evidence = buildInterpretationEvidence(
      kpis({
        sales: { current: 0, previous: 0 },
        leads: { current: 0, previous: 0 },
        conversion: { current: null, previous: null },
        avgTicket: { current: 0, previous: 0 },
        opportunities: { current: 0, previous: 0 },
      }),
    )
    expect(buildInterpretationRecommendation(evidence, ctx())).toBeNull()
  })
})

describe('parseInterpretationResponse', () => {
  it('parses a well-formed response', () => {
    expect(parseInterpretationResponse(JSON.stringify({ interpretation: 'Las ventas subieron.' }))).toBe(
      'Las ventas subieron.',
    )
  })

  it('strips a markdown code fence', () => {
    const raw = '```json\n' + JSON.stringify({ interpretation: 'Texto.' }) + '\n```'
    expect(parseInterpretationResponse(raw)).toBe('Texto.')
  })

  it('returns null for malformed JSON', () => {
    expect(parseInterpretationResponse('not json')).toBeNull()
  })

  it('returns null for an empty interpretation', () => {
    expect(parseInterpretationResponse(JSON.stringify({ interpretation: '   ' }))).toBeNull()
  })

  it('returns null when the interpretation field is missing', () => {
    expect(parseInterpretationResponse(JSON.stringify({ foo: 'bar' }))).toBeNull()
  })
})
