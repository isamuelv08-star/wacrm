import { describe, it, expect } from 'vitest'
import type { CeoAlerts } from '../dashboard/ceo-types'
import type { HotLeadsUnansweredResult } from '../dashboard/ceo-queries'
import type { NextBestActionDisplay } from './queries'
import type { RecoveryCandidate } from './recovery'
import { buildInsights, type BuildInsightsArgs } from './insights'

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

function baseHotUnanswered(overrides: Partial<HotLeadsUnansweredResult> = {}): HotLeadsUnansweredResult {
  return { count: 0, contactIds: [], conversationIds: [], thresholdMinutes: 15, ...overrides }
}

function nextBestAction(overrides: Partial<NextBestActionDisplay> = {}): NextBestActionDisplay {
  return {
    id: 'nba-1',
    dealId: 'deal-1',
    promiseId: null,
    contactId: 'contact-1',
    conversationId: 'conv-1',
    assignedTo: 'seller-1',
    type: 'follow_up_stalled',
    urgency: 'high',
    daysInactive: 10,
    value: 1000,
    contactName: 'María',
    contactPhone: '+593999111222',
    assigneeName: 'Juan',
    ...overrides,
  }
}

function recoveryCandidate(overrides: Partial<RecoveryCandidate> = {}): RecoveryCandidate {
  return {
    contactId: 'contact-2',
    contactName: 'Pedro',
    contactPhone: '+593999333444',
    conversationId: 'conv-2',
    lostDealValue: 500,
    need: 'Repuestos',
    ...overrides,
  }
}

function args(overrides: Partial<BuildInsightsArgs> = {}): BuildInsightsArgs {
  return {
    alerts: baseAlerts(),
    hotUnanswered: baseHotUnanswered(),
    nextBestActions: [],
    recovery: [],
    staleDays: 7,
    overduePromiseCount: 0,
    ...overrides,
  }
}

describe('buildInsights', () => {
  it('returns nothing when every input is clean/empty', () => {
    expect(buildInsights(args())).toEqual([])
  })

  it('never invents a hot_leads_unanswered insight when count is zero, even with contactIds', () => {
    // Defensive case, mirrors rules.test.ts's stalledCount guard.
    const insights = buildInsights(
      args({ hotUnanswered: baseHotUnanswered({ count: 0, contactIds: ['x'] }) }),
    )
    expect(insights).toEqual([])
  })

  it('turns hot leads unanswered into a critical/attention insight with a goToInbox action', () => {
    const insights = buildInsights(
      args({ hotUnanswered: baseHotUnanswered({ count: 17, thresholdMinutes: 15, contactIds: ['a', 'b'] }) }),
    )
    expect(insights).toHaveLength(1)
    expect(insights[0]).toMatchObject({
      type: 'hot_leads_unanswered',
      category: 'attention',
      severity: 'high',
      titleKey: 'hotLeadsUnansweredTitle',
      params: { count: 17, minutes: 15 },
      action: { kind: 'goToInbox' },
      entityIds: ['a', 'b'],
    })
  })

  it('keeps hot_leads_unanswered at medium/risk below the escalation count', () => {
    const insights = buildInsights(args({ hotUnanswered: baseHotUnanswered({ count: 2 }) }))
    expect(insights[0]).toMatchObject({ severity: 'medium', category: 'risk' })
  })

  it('reuses rules.ts severity thresholds for the CeoAlerts-derived insights (never re-derives them)', () => {
    const insights = buildInsights(args({ alerts: baseAlerts({ stalledCount: 3, stalledValue: 60_000 }) }))
    expect(insights).toHaveLength(1)
    expect(insights[0]).toMatchObject({
      type: 'stalled_deals',
      category: 'attention', // rules.ts: stalledValue >= 50_000 => 'high'
      severity: 'high',
      titleKey: 'stalledDealsTitle',
      params: { count: 3, days: 7 },
      valueAtRisk: 60_000,
    })
  })

  it('turns overdue promises into a broken_promises insight with a goToInbox action (not goToPipeline like the other six)', () => {
    const insights = buildInsights(args({ overduePromiseCount: 6 }))
    expect(insights).toHaveLength(1)
    expect(insights[0]).toMatchObject({
      type: 'broken_promises',
      severity: 'high', // rules.ts: overdueCount >= 5 => 'high'
      titleKey: 'brokenPromisesTitle',
      params: { count: 6 },
      action: { kind: 'goToInbox' },
    })
  })

  it('never invents a broken_promises insight when the count is zero', () => {
    expect(buildInsights(args({ overduePromiseCount: 0 }))).toEqual([])
  })

  it('routes a medium-severity alert to the risk category, not attention', () => {
    const insights = buildInsights(args({ alerts: baseAlerts({ atRiskCustomerCount: 5 }) }))
    expect(insights[0]).toMatchObject({ category: 'risk', severity: 'medium' })
  })

  it('surfaces only the FIRST next-best-action as a recommendation insight, never the rest', () => {
    const insights = buildInsights(
      args({
        nextBestActions: [
          nextBestAction({ id: 'a', contactName: 'María', type: 'follow_up_stalled' }),
          nextBestAction({ id: 'b', contactName: 'Second' }),
        ],
      }),
    )
    expect(insights).toHaveLength(1)
    expect(insights[0]).toMatchObject({
      type: 'follow_up_stalled',
      category: 'recommendation',
      severity: null,
      titleKey: 'nextBestAction_follow_up_stalled_Title',
      params: { contactName: 'María', days: 10 },
      action: { kind: 'goToConversation', conversationId: 'conv-1' },
    })
  })

  it('surfaces only the FIRST recovery candidate as an opportunity insight', () => {
    const insights = buildInsights(
      args({
        recovery: [
          recoveryCandidate({ contactId: 'c1', contactName: 'Pedro' }),
          recoveryCandidate({ contactId: 'c2', contactName: 'Second' }),
        ],
      }),
    )
    expect(insights).toHaveLength(1)
    expect(insights[0]).toMatchObject({
      type: 'recovery_opportunity',
      category: 'opportunity',
      titleKey: 'recoveryOpportunityTitle',
      params: { contactName: 'Pedro' },
      valueAtRisk: 500,
      action: { kind: 'goToConversation', conversationId: 'conv-2' },
    })
  })

  it('falls back to goToInbox when a next-best-action/recovery candidate has no conversation', () => {
    const insights = buildInsights(
      args({ recovery: [recoveryCandidate({ conversationId: null })] }),
    )
    expect(insights[0].action).toEqual({ kind: 'goToInbox' })
  })

  it('never caps the feed — the engine returns every detected insight, prioritizing attention > risk > opportunity > recommendation', () => {
    const insights = buildInsights(
      args({
        hotUnanswered: baseHotUnanswered({ count: 17 }), // attention
        alerts: baseAlerts({
          stalledCount: 3,
          stalledValue: 60_000, // attention (high)
          atRiskCustomerCount: 5, // risk (medium)
          winRateDeclinePts: 5, // risk (low)
          salesCycleIncreasePct: 10, // risk (low)
          lowPipelineCoverage: 2.5, // risk (low)
        }),
        nextBestActions: [nextBestAction()], // recommendation
        recovery: [recoveryCandidate()], // opportunity
      }),
    )
    // 8 candidates generated (5 alert-derived signals + hot-unanswered
    // + the next-best-action + the recovery candidate) — all 8 come
    // back, none discarded by the engine itself (capping to a display
    // count is a UI concern, see buildInsights' own doc comment).
    expect(insights).toHaveLength(8)
    expect(insights[0].category).toBe('attention')
    expect(insights[1].category).toBe('attention')
    expect(insights.at(-1)?.category).toBe('recommendation')
  })

  it('attaches a structured evidence trail that mirrors the flat fields, never a second independent value', () => {
    const insights = buildInsights(
      args({ alerts: baseAlerts({ stalledCount: 3, stalledValue: 60_000 }) }),
    )
    const stalled = insights.find((i) => i.type === 'stalled_deals')!
    expect(stalled.evidence.count).toBe(stalled.metricValue)
    expect(stalled.evidence.value).toBe(stalled.valueAtRisk)
    expect(stalled.evidence.entityIds).toBe(stalled.entityIds)
    expect(stalled.evidence.facts).toBe(stalled.params)
  })

  it('is pure — identical input produces the same insights (order and content) on repeat calls', () => {
    const a = args({ hotUnanswered: baseHotUnanswered({ count: 4 }), alerts: baseAlerts({ atRiskCustomerCount: 2 }) })
    const first = buildInsights(a).map((i) => ({ ...i, detectedAt: undefined }))
    const second = buildInsights(a).map((i) => ({ ...i, detectedAt: undefined }))
    expect(first).toEqual(second)
  })
})
