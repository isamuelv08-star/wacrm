import { describe, expect, it } from 'vitest'
import { buildDecisionAction, buildDecisionActions } from './decision-actions'
import type { Insight } from './insights'

function insight(overrides: Partial<Insight> = {}): Insight {
  return {
    type: 'stalled_deals',
    category: 'attention',
    severity: 'high',
    titleKey: 'stalledDealsTitle',
    descriptionKey: 'stalledDealsDesc',
    params: { count: 3, days: 7 },
    metricValue: 3,
    valueAtRisk: 60_000,
    entityIds: ['deal-1', 'deal-2'],
    evidence: { count: 3, value: 60_000, entityIds: ['deal-1', 'deal-2'], facts: { count: 3, days: 7 } },
    action: { kind: 'goToPipeline' },
    detectedAt: '2026-09-23T00:00:00.000Z',
    ...overrides,
  }
}

describe('buildDecisionAction', () => {
  it('maps a known insight type to its action type', () => {
    expect(buildDecisionAction(insight({ type: 'hot_leads_unanswered' })).actionType).toBe('REVIEW_HOT_LEADS')
    expect(buildDecisionAction(insight({ type: 'broken_promises' })).actionType).toBe('FULFILL_PROMISE')
    expect(buildDecisionAction(insight({ type: 'at_risk_customers' })).actionType).toBe('REVIEW_AT_RISK_CUSTOMERS')
  })

  it('falls back to REVIEW_METRIC for account-level metric trends', () => {
    expect(buildDecisionAction(insight({ type: 'forecast_gap' })).actionType).toBe('REVIEW_METRIC')
    expect(buildDecisionAction(insight({ type: 'win_rate_decline' })).actionType).toBe('REVIEW_METRIC')
  })

  it('escalates a low-value stalled-deal action to RECOVER_STALLED, not HIGH_VALUE_FOLLOW_UP, below the threshold', () => {
    const action = buildDecisionAction(insight({ type: 'stalled_deals', valueAtRisk: 5_000 }))
    expect(action.actionType).toBe('RECOVER_STALLED')
  })

  it('escalates a high-value stalled-deal action to HIGH_VALUE_FOLLOW_UP at/above the threshold', () => {
    const action = buildDecisionAction(insight({ type: 'stalled_deals', valueAtRisk: 10_000 }))
    expect(action.actionType).toBe('HIGH_VALUE_FOLLOW_UP')
  })

  it('escalates a high-value follow-up action the same way', () => {
    const action = buildDecisionAction(insight({ type: 'follow_up_stalled', valueAtRisk: 25_000 }))
    expect(action.actionType).toBe('HIGH_VALUE_FOLLOW_UP')
  })

  it('never escalates a non-follow-up action type regardless of value', () => {
    const action = buildDecisionAction(insight({ type: 'at_risk_customers', valueAtRisk: 1_000_000 }))
    expect(action.actionType).toBe('REVIEW_AT_RISK_CUSTOMERS')
  })

  it('maps severity+category to priority: high+attention is CRITICAL', () => {
    expect(buildDecisionAction(insight({ severity: 'high', category: 'attention' })).priority).toBe('CRITICAL')
  })

  it('maps severity+category to priority: high+risk is HIGH, not CRITICAL', () => {
    expect(buildDecisionAction(insight({ severity: 'high', category: 'risk' })).priority).toBe('HIGH')
  })

  it('maps medium/low severity to MEDIUM/LOW', () => {
    expect(buildDecisionAction(insight({ severity: 'medium' })).priority).toBe('MEDIUM')
    expect(buildDecisionAction(insight({ severity: 'low' })).priority).toBe('LOW')
  })

  it('defaults a severity-less insight (Next Best Action / Recovery) to HIGH priority', () => {
    expect(buildDecisionAction(insight({ severity: null, category: 'recommendation' })).priority).toBe('HIGH')
  })

  it('carries entityIds and economicImpact straight from the insight, never recomputing them', () => {
    const action = buildDecisionAction(insight({ entityIds: ['a', 'b', 'c'], valueAtRisk: 42 }))
    expect(action.entityIds).toEqual(['a', 'b', 'c'])
    expect(action.economicImpact).toBe(42)
  })

  it('carries the insight type as `reason` so display text is looked up, never duplicated', () => {
    expect(buildDecisionAction(insight({ type: 'stalled_deals' })).reason).toBe('stalled_deals')
  })
})

describe('buildDecisionActions', () => {
  it('produces one action per insight, same order', () => {
    const insights = [
      insight({ type: 'stalled_deals', valueAtRisk: 1_000 }),
      insight({ type: 'broken_promises' }),
    ]
    const actions = buildDecisionActions(insights)
    expect(actions).toHaveLength(2)
    expect(actions[0].actionType).toBe('RECOVER_STALLED')
    expect(actions[1].actionType).toBe('FULFILL_PROMISE')
  })

  it('returns an empty array for an empty insight list', () => {
    expect(buildDecisionActions([])).toEqual([])
  })
})
