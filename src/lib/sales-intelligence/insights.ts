import type { CeoAlerts } from '../dashboard/ceo-types'
import type { HotLeadsUnansweredResult } from '../dashboard/ceo-queries'
import { buildBrokenPromiseSignal, buildSignalsFromAlerts } from './rules'
import type { SignalDraft, SignalSeverity, SignalType } from './types'
import type { NextBestActionDisplay } from './queries'
import type { NextBestActionType } from './next-best-action'
import type { RecoveryCandidate } from './recovery'

// ============================================================
// "Saleslid detectó" — the Intelligence Layer's insight feed
// (Auditoría Saleslid: Centro de Control del Gerente + Informe
// Comercial Diario). Pure, DB-free, unit-tested the same way rules.ts
// already is — it does not compute anything itself, it only PACKAGES
// numbers other, already-existing functions already computed:
//   - the 6 CeoAlerts checks + broken promises, via rules.ts's own
//     buildSignalsFromAlerts/buildBrokenPromiseSignal (same severity
//     thresholds already calibrated for sales_signals — reused, not
//     re-derived, so this feed can never disagree with that table
//     once its cron is live again),
//   - HOT leads unanswered past the account's own alert threshold
//     (ceo-queries.ts::countHotLeadsUnanswered — the one genuinely
//     new aggregate this layer needed, built on the exact candidate
//     query hot-lead-alerts.ts already runs every 5 minutes),
//   - the single most urgent Next Best Action and the single best
//     Recovery candidate — not the full lists (those already have
//     their own dashboard cards; this feed only borrows their TOP
//     pick so "Saleslid detectó" reads as 3-5 headlines, not a dump).
//
// Deliberately carries NO user-facing text: `titleKey`/`descriptionKey`
// are next-intl keys under the `Dashboard.insights` namespace, and
// `params` is what the component passes to `t(key, params)` — the
// same "data in, component translates" split `AlertsCard` already
// uses for the same six numbers. Keeping this function 100%
// presentation-free is what makes it a plain, DB-free unit test
// instead of one that has to mock next-intl too.
// ============================================================

export type InsightType =
  | SignalType
  | 'hot_leads_unanswered'
  | NextBestActionType
  | 'recovery_opportunity'

/** Maps onto the brief's own four sections: 🔴 Atención, 🟡 Riesgo,
 *  🟢 Oportunidad, 🎯 Recomendación. */
export type InsightCategory = 'attention' | 'risk' | 'opportunity' | 'recommendation'

export type InsightActionKind = 'goToInbox' | 'goToConversation' | 'goToPipeline'

export interface InsightAction {
  kind: InsightActionKind
  /** Only present for 'goToConversation'. */
  conversationId?: string
}

export interface Insight {
  type: InsightType
  category: InsightCategory
  /** Only meaningful for 'attention'/'risk' — mirrors sales_signals'
   *  own low/medium/high, so this feed and that table (once its cron
   *  is live) never disagree on how urgent something is. */
  severity: SignalSeverity | null
  /** next-intl key under `Dashboard.insights`, e.g. 'stalledDealsTitle'. */
  titleKey: string
  descriptionKey: string
  params: Record<string, number | string>
  metricValue: number | null
  valueAtRisk: number | null
  entityIds: string[]
  action: InsightAction
  detectedAt: string
}

export interface BuildInsightsArgs {
  alerts: CeoAlerts
  hotUnanswered: HotLeadsUnansweredResult
  /** Already ranked by buildNextBestActions — only the FIRST (most
   *  urgent) one is surfaced here as the 🎯 Recomendación; the rest
   *  stay exclusive to NextBestActionCard, which already lists them
   *  all in full. */
  nextBestActions: NextBestActionDisplay[]
  /** Same posture — only the best candidate becomes a 🟢 Oportunidad
   *  insight; RecoveryCard already lists the rest. */
  recovery: RecoveryCandidate[]
  /** Same window `loadCeoAlerts`/`findStalledOpenDeals` were called
   *  with — folded into the stalled_deals description ("llevan más de
   *  N días sin cambiar de etapa"). */
  staleDays: number
  /** `countOverduePromises` (queries.ts) — fase 4/5's Promise Tracker
   *  / Sales Leak Detector. Empty/0 whenever an account never enabled
   *  Promise Tracker (or its cron hasn't run — see this feature's own
   *  audit note on that), same as every other input here. */
  overduePromiseCount: number
}

const MAX_INSIGHTS = 5

const CATEGORY_RANK: Record<InsightCategory, number> = {
  attention: 0,
  risk: 1,
  opportunity: 2,
  recommendation: 3,
}

function signalSeverityToCategory(severity: SignalSeverity): InsightCategory {
  return severity === 'high' ? 'attention' : 'risk'
}

function signalToInsight(signal: SignalDraft, detectedAt: string, staleDays: number): Insight {
  const base = {
    type: signal.signalType,
    category: signalSeverityToCategory(signal.severity),
    severity: signal.severity,
    metricValue: signal.metricValue,
    valueAtRisk: signal.valueAtRisk,
    entityIds: [] as string[],
    action: { kind: 'goToPipeline' as const },
    detectedAt,
  }
  switch (signal.signalType) {
    case 'forecast_gap':
      return {
        ...base,
        titleKey: 'forecastGapTitle',
        descriptionKey: 'forecastGapDesc',
        params: { pct: Math.round(Math.abs(signal.metricValue ?? 0)) },
      }
    case 'low_pipeline_coverage':
      return {
        ...base,
        titleKey: 'lowPipelineCoverageTitle',
        descriptionKey: 'lowPipelineCoverageDesc',
        params: { multiple: Number((signal.metricValue ?? 0).toFixed(1)) },
      }
    case 'stalled_deals':
      return {
        ...base,
        titleKey: 'stalledDealsTitle',
        descriptionKey: 'stalledDealsDesc',
        params: { count: signal.metricValue ?? 0, days: staleDays },
      }
    case 'win_rate_decline':
      return {
        ...base,
        titleKey: 'winRateDeclineTitle',
        descriptionKey: 'winRateDeclineDesc',
        params: { pts: Math.round(signal.metricValue ?? 0) },
      }
    case 'sales_cycle_increase':
      return {
        ...base,
        titleKey: 'salesCycleIncreaseTitle',
        descriptionKey: 'salesCycleIncreaseDesc',
        params: { pct: Math.round(signal.metricValue ?? 0) },
      }
    case 'at_risk_customers':
      return {
        ...base,
        titleKey: 'atRiskCustomersTitle',
        descriptionKey: 'atRiskCustomersDesc',
        params: { count: signal.metricValue ?? 0 },
      }
    case 'broken_promises':
      // Conversation-level, not pipeline-level — goToInbox reads more
      // honestly than goToPipeline for this one, unlike the other six
      // (which really are about deals sitting in the pipeline).
      return {
        ...base,
        titleKey: 'brokenPromisesTitle',
        descriptionKey: 'brokenPromisesDesc',
        params: { count: signal.metricValue ?? 0 },
        action: { kind: 'goToInbox' },
      }
  }
}

/** Same "count of troubled entities" shape rules.ts already uses for
 *  at_risk_customers (≥10 high / ≥4 medium / else low), but escalated
 *  one notch: a HOT lead is a customer with active buying interest
 *  ALREADY waiting past the account's own alert threshold, so even a
 *  single one is worth flagging as needing attention today rather
 *  than filed as a background risk. */
function hotUnansweredSeverity(count: number): SignalSeverity {
  if (count >= 5) return 'high'
  return 'medium'
}

export function buildInsights(args: BuildInsightsArgs): Insight[] {
  const { alerts, hotUnanswered, nextBestActions, recovery, staleDays, overduePromiseCount } = args
  const detectedAt = new Date().toISOString()
  const insights: Insight[] = []

  if (hotUnanswered.count > 0) {
    const severity = hotUnansweredSeverity(hotUnanswered.count)
    insights.push({
      type: 'hot_leads_unanswered',
      category: signalSeverityToCategory(severity),
      severity,
      titleKey: 'hotLeadsUnansweredTitle',
      descriptionKey: 'hotLeadsUnansweredDesc',
      params: { count: hotUnanswered.count, minutes: hotUnanswered.thresholdMinutes },
      metricValue: hotUnanswered.count,
      valueAtRisk: null,
      entityIds: hotUnanswered.contactIds,
      action: { kind: 'goToInbox' },
      detectedAt,
    })
  }

  const alertSignals = buildSignalsFromAlerts(alerts)
  for (const signal of alertSignals) {
    insights.push(signalToInsight(signal, detectedAt, staleDays))
  }

  const brokenPromiseSignal = buildBrokenPromiseSignal(overduePromiseCount)
  if (brokenPromiseSignal) {
    insights.push(signalToInsight(brokenPromiseSignal, detectedAt, staleDays))
  }

  const topAction = nextBestActions[0]
  if (topAction) {
    insights.push({
      type: topAction.type,
      category: 'recommendation',
      severity: null,
      titleKey: `nextBestAction_${topAction.type}_Title`,
      descriptionKey: `nextBestAction_${topAction.type}_Desc`,
      params: {
        contactName: topAction.contactName || topAction.contactPhone || '',
        days: topAction.daysInactive,
      },
      metricValue: topAction.daysInactive,
      valueAtRisk: topAction.value,
      entityIds: [topAction.contactId, topAction.dealId, topAction.promiseId].filter(
        (id): id is string => !!id,
      ),
      action: topAction.conversationId
        ? { kind: 'goToConversation', conversationId: topAction.conversationId }
        : { kind: 'goToInbox' },
      detectedAt,
    })
  }

  const topRecovery = recovery[0]
  if (topRecovery) {
    insights.push({
      type: 'recovery_opportunity',
      category: 'opportunity',
      severity: null,
      titleKey: 'recoveryOpportunityTitle',
      descriptionKey: 'recoveryOpportunityDesc',
      params: { contactName: topRecovery.contactName || topRecovery.contactPhone },
      metricValue: null,
      valueAtRisk: topRecovery.lostDealValue,
      entityIds: [topRecovery.contactId],
      action: topRecovery.conversationId
        ? { kind: 'goToConversation', conversationId: topRecovery.conversationId }
        : { kind: 'goToInbox' },
      detectedAt,
    })
  }

  return insights
    .sort((a, b) => {
      const catDelta = CATEGORY_RANK[a.category] - CATEGORY_RANK[b.category]
      if (catDelta !== 0) return catDelta
      const severityRank: Record<SignalSeverity, number> = { high: 0, medium: 1, low: 2 }
      const sevDelta = (a.severity ? severityRank[a.severity] : 1) - (b.severity ? severityRank[b.severity] : 1)
      if (sevDelta !== 0) return sevDelta
      return (b.valueAtRisk ?? b.metricValue ?? 0) - (a.valueAtRisk ?? a.metricValue ?? 0)
    })
    .slice(0, MAX_INSIGHTS)
}
