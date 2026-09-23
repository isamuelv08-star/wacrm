import { describe, expect, it } from 'vitest'
import {
  buildDeterministicInterpretation,
  buildInterpretationEvidence,
  buildInterpretationRecommendation,
  parseInterpretationResponse,
  pickHeadlineEvidence,
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

describe('buildDeterministicInterpretation', () => {
  it('never invents a number outside the given evidence', () => {
    const evidence = buildInterpretationEvidence(kpis())
    const text = buildDeterministicInterpretation(evidence, 'last7Days')
    expect(text).toContain('conversión bajó 10.0 puntos')
    expect(text).toContain('ventas subió 25.0%')
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
    const text = buildDeterministicInterpretation(evidence, 'today')
    expect(text).toMatch(/No hay suficientes datos/)
  })

  it('falls back to the custom range phrase for an unknown preset label', () => {
    const evidence = buildInterpretationEvidence(kpis())
    // @ts-expect-error deliberately passing a value outside PeriodPreset to exercise the fallback
    const text = buildDeterministicInterpretation(evidence, 'not-a-real-preset')
    expect(text).toMatch(/^En el período seleccionado/)
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

describe('buildInterpretationRecommendation', () => {
  it('ties the recommendation to the worst-declining metric, not a generic message', () => {
    const evidence = buildInterpretationEvidence(kpis({ conversion: { current: 10, previous: 40 } }))
    const rec = buildInterpretationRecommendation(evidence)
    expect(rec?.title).toBe('Revisa el manejo de las conversaciones')
  })

  it('picks the sales recommendation when sales fell the most', () => {
    const evidence = buildInterpretationEvidence(kpis({ sales: { current: 100, previous: 1000 } }))
    const rec = buildInterpretationRecommendation(evidence)
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
    const rec = buildInterpretationRecommendation(evidence)
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
    expect(buildInterpretationRecommendation(evidence)).toBeNull()
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
    expect(buildInterpretationRecommendation(evidence)).toBeNull()
  })
})
