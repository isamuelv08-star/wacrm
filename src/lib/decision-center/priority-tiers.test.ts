import { describe, expect, it } from 'vitest'
import { groupDecisionsByTier } from './priority-tiers'
import type { Insight } from '@/lib/sales-intelligence/insights'
import type { DecisionAction, DecisionActionPriority } from '@/lib/sales-intelligence/decision-actions'

const insight = (type: string): Insight => ({
  type: type as Insight['type'],
  category: 'attention',
  severity: 'high',
  titleKey: 'x',
  descriptionKey: 'y',
  params: {},
  metricValue: null,
  valueAtRisk: null,
  entityIds: [],
  evidence: { count: null, value: null, entityIds: [], facts: {} },
  action: { kind: 'goToPipeline' },
  detectedAt: '2026-09-23T00:00:00.000Z',
})

const action = (priority: DecisionActionPriority): DecisionAction => ({
  actionType: 'REVIEW_METRIC',
  reason: 'forecast_gap',
  priority,
  entityIds: [],
  economicImpact: null,
})

describe('groupDecisionsByTier', () => {
  it('puts CRITICAL decisions in actNow', () => {
    const decisions = [insight('stalled_deals')]
    const actions = [action('CRITICAL')]
    const tiers = groupDecisionsByTier(decisions, actions)
    expect(tiers.actNow).toHaveLength(1)
    expect(tiers.reviewToday).toHaveLength(0)
    expect(tiers.watch).toHaveLength(0)
  })

  it('puts HIGH decisions in reviewToday', () => {
    const decisions = [insight('win_rate_decline')]
    const actions = [action('HIGH')]
    const tiers = groupDecisionsByTier(decisions, actions)
    expect(tiers.reviewToday).toHaveLength(1)
  })

  it('puts MEDIUM and LOW decisions in watch', () => {
    const decisions = [insight('sales_cycle_increase'), insight('recovery_opportunity')]
    const actions = [action('MEDIUM'), action('LOW')]
    const tiers = groupDecisionsByTier(decisions, actions)
    expect(tiers.watch).toHaveLength(2)
  })

  it('handles multiple decisions across all three tiers at once', () => {
    const decisions = [insight('a'), insight('b'), insight('c'), insight('d')]
    const actions = [action('CRITICAL'), action('HIGH'), action('MEDIUM'), action('LOW')]
    const tiers = groupDecisionsByTier(decisions, actions)
    expect(tiers.actNow).toHaveLength(1)
    expect(tiers.reviewToday).toHaveLength(1)
    expect(tiers.watch).toHaveLength(2)
  })

  it('returns all-empty tiers when there are no decisions — never fabricates a tier item', () => {
    const tiers = groupDecisionsByTier([], [])
    expect(tiers.actNow).toEqual([])
    expect(tiers.reviewToday).toEqual([])
    expect(tiers.watch).toEqual([])
  })
})
