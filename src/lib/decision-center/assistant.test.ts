import { describe, expect, it } from 'vitest'
import { buildDecisionCenterSnapshot, parseDecisionCenterAnswer } from './assistant'
import type { DecisionCenterPayload } from './payload'

const emptyPayload: DecisionCenterPayload = {
  range: { label: 'last7Days', start: '2026-09-16T00:00:00.000Z', end: '2026-09-23T00:00:00.000Z' },
  kpis: {
    sales: { current: 1000, previous: 800 },
    leads: { current: 10, previous: 8 },
    conversion: { current: 25, previous: 30 },
    avgTicket: { current: 100, previous: 100 },
    opportunities: { current: 5, previous: 4 },
  },
  interpretation: 'Las ventas subieron 25.0% frente al período anterior.',
  interpretationEvidence: [],
  interpretationRecommendation: null,
  decisions: [],
  decisionActions: [],
  todayPriorities: [],
  money: {
    atRisk: { totalValue: 0, totalCount: 0, bySeller: [], byStage: [] },
    recoveryOpportunities: [],
    staleDays: 7,
  },
  breakdown: {
    bySeller: [],
    worstDecliningSeller: null,
    bestImprovingSeller: null,
    stageDropoffs: [],
    biggestLeakStage: null,
  },
}

describe('buildDecisionCenterSnapshot', () => {
  it('includes every KPI with its current and previous value', () => {
    const snapshot = buildDecisionCenterSnapshot(emptyPayload, 'USD')
    expect(snapshot).toContain('Ventas')
    expect(snapshot).toContain('Leads: 10')
    expect(snapshot).toContain('anterior: 8')
    expect(snapshot).toContain('25.0%')
  })

  it('states plainly when there is nothing urgent, never fabricating a decision', () => {
    const snapshot = buildDecisionCenterSnapshot(emptyPayload, 'USD')
    expect(snapshot).toContain('ninguna — nada urgente en este momento')
    expect(snapshot).toContain('nada urgente pendiente')
  })

  it('reports the funnel leak and seller deltas when present', () => {
    const payload: DecisionCenterPayload = {
      ...emptyPayload,
      breakdown: {
        ...emptyPayload.breakdown,
        biggestLeakStage: {
          fromKey: 'qualified',
          fromLabel: 'Calificados',
          toKey: 'won',
          toLabel: 'Ganados',
          fromCount: 100,
          toCount: 10,
          dropPct: 90,
        },
        worstDecliningSeller: {
          userId: 'u1',
          name: 'Ana',
          dealsWonCurrent: 1,
          dealsWonPrevious: 5,
          dealsLostCurrent: 4,
          dealsLostPrevious: 1,
          winRateCurrent: 20,
          winRatePrevious: 80,
          valueWonCurrent: 100,
          valueWonPrevious: 500,
          avgTicketCurrent: 100,
          avgTicketPrevious: 100,
          winRateDeltaPts: -60,
        },
        bestImprovingSeller: null,
      },
    }
    const snapshot = buildDecisionCenterSnapshot(payload, 'USD')
    expect(snapshot).toContain('Calificados')
    expect(snapshot).toContain('90.0%')
    expect(snapshot).toContain('Ana')
    expect(snapshot).toContain('60.0 puntos')
  })
})

describe('parseDecisionCenterAnswer', () => {
  it('parses a well-formed response', () => {
    const out = parseDecisionCenterAnswer(
      JSON.stringify({
        answer: 'Las ventas subieron 25%.',
        evidence: ['Ventas actuales: $1000', 'Ventas período anterior: $800'],
        recommendation: 'Mantener el ritmo actual.',
      }),
    )
    expect(out?.answer).toBe('Las ventas subieron 25%.')
    expect(out?.evidence).toHaveLength(2)
    expect(out?.recommendation).toBe('Mantener el ritmo actual.')
  })

  it('strips a markdown code fence', () => {
    const raw = '```json\n' + JSON.stringify({ answer: 'Texto.', evidence: [], recommendation: null }) + '\n```'
    expect(parseDecisionCenterAnswer(raw)?.answer).toBe('Texto.')
  })

  it('caps evidence at 4 items', () => {
    const out = parseDecisionCenterAnswer(
      JSON.stringify({ answer: 'x', evidence: ['a', 'b', 'c', 'd', 'e', 'f'], recommendation: null }),
    )
    expect(out?.evidence).toHaveLength(4)
  })

  it('returns null for malformed JSON', () => {
    expect(parseDecisionCenterAnswer('not json')).toBeNull()
  })

  it('returns null when the answer field is missing or empty', () => {
    expect(parseDecisionCenterAnswer(JSON.stringify({ evidence: [], recommendation: null }))).toBeNull()
    expect(parseDecisionCenterAnswer(JSON.stringify({ answer: '   ', evidence: [] }))).toBeNull()
  })

  it('treats a missing recommendation as null, not a required field', () => {
    const out = parseDecisionCenterAnswer(JSON.stringify({ answer: 'x', evidence: [] }))
    expect(out?.recommendation).toBeNull()
  })
})
