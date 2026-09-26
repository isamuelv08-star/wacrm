import { describe, it, expect } from 'vitest'
import {
  buildTurnAnalysisPrompt,
  decideDealMove,
  evidenceInTranscript,
  normalizeForMatch,
  parseTurnAnalysis,
  type StageForAnalysis,
} from './core'

const S = (id: string, position: number, flags: Partial<StageForAnalysis> = {}): StageForAnalysis => ({
  id,
  name: id,
  position,
  description: null,
  isQualified: false,
  isWon: false,
  isLost: false,
  isFollowup: false,
  ...flags,
})

// Nuevo(0) Calificado(1) Propuesta(2) Negociación(3) Ganado(4) Perdido(5) Seguimiento(6)
const STAGES = [
  S('new', 0),
  S('qual', 1, { isQualified: true }),
  S('prop', 2),
  S('neg', 3),
  S('won', 4, { isWon: true }),
  S('lost', 5, { isLost: true }),
  S('fup', 6, { isFollowup: true }),
]

const base = {
  stages: STAGES,
  preFollowupStageId: null,
  stageEvidenceOk: true,
  outcomeEvidenceOk: true,
  minConfidence: 0.75,
  humanHold: false,
}
const move = (stageKey: string | null, confidence = 0.9) => ({
  stageKey,
  stageConfidence: confidence,
  outcome: null,
  outcomeConfidence: 0,
})

describe('decideDealMove', () => {
  it('moves forward and may skip steps (S3 = Propuesta)', () => {
    expect(decideDealMove({ ...base, currentStageId: 'new', analysis: move('S3') })).toEqual({
      action: 'move',
      toStageId: 'prop',
    })
  })

  it('never moves backwards', () => {
    expect(decideDealMove({ ...base, currentStageId: 'neg', analysis: move('S2') })).toMatchObject({
      action: 'none',
      skipReason: 'not_forward',
    })
  })

  it('needs confidence and a real quote', () => {
    expect(decideDealMove({ ...base, currentStageId: 'new', analysis: move('S2', 0.5) })).toMatchObject({
      skipReason: 'low_confidence',
    })
    expect(
      decideDealMove({ ...base, stageEvidenceOk: false, currentStageId: 'new', analysis: move('S2') }),
    ).toMatchObject({ skipReason: 'evidence_not_found' })
  })

  it('respects a recent human move', () => {
    expect(decideDealMove({ ...base, humanHold: true, currentStageId: 'new', analysis: move('S3') })).toMatchObject({
      skipReason: 'human_hold',
    })
  })

  it('from follow-up, measures forward from the stage it was parked from', () => {
    expect(
      decideDealMove({ ...base, currentStageId: 'fup', preFollowupStageId: 'prop', analysis: move('S4') }),
    ).toEqual({ action: 'move', toStageId: 'neg' })
    expect(
      decideDealMove({ ...base, currentStageId: 'fup', preFollowupStageId: 'prop', analysis: move('S3') }),
    ).toEqual({ action: 'move', toStageId: 'prop' })
    expect(
      decideDealMove({ ...base, currentStageId: 'fup', preFollowupStageId: 'prop', analysis: move('S2') }),
    ).toMatchObject({ skipReason: 'not_forward' })
  })

  it('closes as won only with high confidence and evidence', () => {
    const won = { stageKey: null, stageConfidence: 0, outcome: 'won' as const, outcomeConfidence: 0.95 }
    expect(decideDealMove({ ...base, currentStageId: 'neg', analysis: won })).toEqual({ action: 'won', toStageId: 'won' })
    expect(
      decideDealMove({ ...base, currentStageId: 'neg', analysis: { ...won, outcomeConfidence: 0.7 } }),
    ).toMatchObject({ skipReason: 'low_outcome_confidence' })
    expect(
      decideDealMove({ ...base, outcomeEvidenceOk: false, currentStageId: 'neg', analysis: won }),
    ).toMatchObject({ skipReason: 'outcome_evidence_not_found' })
  })

  it('never offers follow-up/won/lost as plain stages (S5 does not exist)', () => {
    expect(decideDealMove({ ...base, currentStageId: 'new', analysis: move('S5') })).toMatchObject({
      skipReason: 'unknown_stage',
    })
  })
})

describe('evidenceInTranscript', () => {
  const t = normalizeForMatch('[2026-09-25 10:00] Customer: Ya te hice la transferencia de $580, ¿me confirmas?')
  it('accepts an exact quote regardless of accents/case/punctuation', () => {
    expect(evidenceInTranscript('ya te hice la TRANSFERENCIA de $580', t)).toBe(true)
  })
  it('rejects an invented quote', () => {
    expect(evidenceInTranscript('ya pagué todo el pedido completo', t)).toBe(false)
  })
})

describe('parseTurnAnalysis', () => {
  it('parses a fenced JSON answer and drops filler facts', () => {
    const a = parseTurnAnalysis(
      '```json\n{"score":"hot","facts":{"need":"más información","city":"Quito","productInterest":"205/55R16 x4"},' +
        '"customFields":{"Ciudad":"Quito"},"tags":["Mayorista"],' +
        '"deal":{"stage":"S3","confidence":0.9,"evidence":"le envié la proforma","outcome":null,"value":"580"},' +
        '"summary":"Quiere 4 llantas"}\n```',
    )
    expect(a.score).toBe('hot')
    expect(a.facts).toEqual({ city: 'Quito', productInterest: '205/55R16 x4' })
    expect(a.customFields).toEqual({ Ciudad: 'Quito' })
    expect(a.tags).toEqual(['Mayorista'])
    expect(a.stageKey).toBe('S3')
    expect(a.dealValue).toBe(580)
  })

  it('treats garbage as no signal', () => {
    const a = parseTurnAnalysis('not json')
    expect(a.score).toBeNull()
    expect(a.stageKey).toBeNull()
    expect(a.outcome).toBeNull()
  })
})

describe('buildTurnAnalysisPrompt', () => {
  it('lists only open stages with their meaning and marks the current one', () => {
    const p = buildTurnAnalysisPrompt({
      businessContext: null,
      qualificationCriteria: null,
      stages: STAGES.map((s) => ({ ...s, description: `desc ${s.id}` })),
      currentStageId: 'qual',
      knownFacts: { city: 'Quito' },
      previousScore: 'warm',
      previousScoreReason: null,
      customFields: [{ name: 'Ciudad', type: 'text', options: [], currentValue: null }],
      tags: ['Mayorista'],
      currency: 'USD',
      nowLabel: '2026-09-25 10:00',
    })
    expect(p).toContain('S2 "qual" (CURRENT): desc qual')
    expect(p).toContain('S4 "neg"')
    expect(p).not.toContain('"won"  ')
    expect(p).not.toContain('S5 ')
    expect(p).toContain('city: Quito')
    expect(p).toContain('"Mayorista"')
  })
})
