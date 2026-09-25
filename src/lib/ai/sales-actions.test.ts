import { describe, it, expect } from 'vitest'
import { pickStageMove } from './sales-actions'

const STAGES = [
  { id: 'new', name: 'Nuevo lead', position: 0 },
  { id: 'qual', name: 'Calificado', position: 1 },
  { id: 'prop', name: 'Propuesta_enviada', position: 2 },
  { id: 'won', name: 'Ganado', position: 3, is_won_stage: true },
  { id: 'lost', name: 'Perdido', position: 4, is_lost_stage: true },
  { id: 'fup', name: 'Seguimiento', position: 5, is_followup_stage: true },
]

describe('pickStageMove', () => {
  it('matches the stage name exactly, ignoring case and spacing', () => {
    expect(pickStageMove(STAGES, 'new', '  calificado ')).toEqual({ ok: true, stageId: 'qual' })
  })

  it('does not treat _ or % in names as wildcards', () => {
    expect(pickStageMove(STAGES, 'new', 'Propuesta enviada').ok).toBe(false)
    expect(pickStageMove(STAGES, 'new', 'Propuesta_enviada')).toEqual({ ok: true, stageId: 'prop' })
    expect(pickStageMove(STAGES, 'new', 'Cal%').ok).toBe(false)
  })

  it('refuses won/lost stages — those go through DEAL_WON / DEAL_LOST', () => {
    expect(pickStageMove(STAGES, 'prop', 'Ganado').ok).toBe(false)
    expect(pickStageMove(STAGES, 'prop', 'Perdido').ok).toBe(false)
  })

  it('refuses to move a deal backwards', () => {
    expect(pickStageMove(STAGES, 'prop', 'Calificado').ok).toBe(false)
  })

  it('allows moving out of the follow-up stage', () => {
    expect(pickStageMove(STAGES, 'fup', 'Calificado')).toEqual({ ok: true, stageId: 'qual' })
  })

  it('refuses an ambiguous name', () => {
    const dup = [...STAGES, { id: 'qual2', name: 'CALIFICADO', position: 6 }]
    expect(pickStageMove(dup, 'new', 'Calificado').ok).toBe(false)
  })
})
