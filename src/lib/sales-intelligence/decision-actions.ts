import type { Insight, InsightType } from './insights'
import { STALLED_VALUE_THRESHOLDS } from './thresholds'

// ============================================================
// DecisionAction — the contract between Centro de Decisiones and a
// FUTURE Centro de Seguimiento. Not consumed by any screen yet (no
// route, no UI reads this today) — this module exists purely to
// leave every Insight Centro de Decisiones already detects prepared
// to become a concrete, queueable action later, without having to
// rework how insights are built when that module exists.
//
// Adapted from the brief's suggested shape rather than copied
// verbatim: `reason` reuses `InsightType` (the enum Insight already
// carries) instead of a second, parallel "why" enum that could drift
// out of sync with it, and `context` is left out entirely — a
// DecisionAction is a machine-readable queue item, not something
// rendered yet, and any future display can already look up
// titleKey/descriptionKey/params from the Insight `reason` points
// back to instead of this module inventing pre-rendered text no
// screen reads.
//
// Pure, no I/O — every field here comes straight from fields
// buildInsights already computed (priority from severity/category,
// economicImpact from valueAtRisk, entityIds as-is). No new
// calculation happens in this file.
// ============================================================

export type DecisionActionType =
  | 'FOLLOW_UP'
  | 'HIGH_VALUE_FOLLOW_UP'
  | 'RECOVER_STALLED'
  | 'RECOVER_COLD_LEAD'
  | 'REVIEW_HOT_LEADS'
  | 'REVIEW_AT_RISK_CUSTOMERS'
  | 'FULFILL_PROMISE'
  /** Account-level metric trends (forecast gap, low pipeline
   *  coverage, win-rate decline, sales-cycle increase) — worth
   *  reviewing, but not a single lead/deal a rep can be pointed at,
   *  unlike every other action type here. */
  | 'REVIEW_METRIC'

export type DecisionActionPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

export interface DecisionAction {
  actionType: DecisionActionType
  /** Which Insight this was derived from — look up that Insight's
   *  titleKey/descriptionKey/params for display text; never
   *  duplicated here. */
  reason: InsightType
  priority: DecisionActionPriority
  entityIds: string[]
  economicImpact: number | null
}

/** A stalled/follow-up action gets escalated to HIGH_VALUE_FOLLOW_UP
 *  when real money is on the line — same bar `rules.ts` already uses
 *  for "this stalled-deal value is worth a high severity", reused
 *  rather than inventing a second dollar threshold. */
const HIGH_VALUE_THRESHOLD = STALLED_VALUE_THRESHOLDS.medium

const ACTION_TYPE_BY_INSIGHT_TYPE: Partial<Record<InsightType, DecisionActionType>> = {
  hot_leads_unanswered: 'REVIEW_HOT_LEADS',
  stalled_deals: 'RECOVER_STALLED',
  at_risk_customers: 'REVIEW_AT_RISK_CUSTOMERS',
  broken_promises: 'FULFILL_PROMISE',
  forecast_gap: 'REVIEW_METRIC',
  low_pipeline_coverage: 'REVIEW_METRIC',
  win_rate_decline: 'REVIEW_METRIC',
  sales_cycle_increase: 'REVIEW_METRIC',
  recovery_opportunity: 'RECOVER_COLD_LEAD',
  follow_up_stalled: 'FOLLOW_UP',
  re_engage_silent: 'FOLLOW_UP',
  fulfill_broken_promise: 'FULFILL_PROMISE',
}

/** Mirrors sales_signals' own low/medium/high, escalated one notch
 *  for `attention` (🔴 Problemas are the most urgent bucket) —
 *  matches how Insight.severity/category already relate. Insights
 *  with no severity at all (Next Best Action / Recovery — already
 *  the single TOP pick from an urgency-ranked list, see
 *  insights.ts) default to HIGH: they earned their place by already
 *  being the most urgent candidate in their own list. */
function priorityFor(insight: Insight): DecisionActionPriority {
  if (insight.severity === 'high') return insight.category === 'attention' ? 'CRITICAL' : 'HIGH'
  if (insight.severity === 'medium') return 'MEDIUM'
  if (insight.severity === 'low') return 'LOW'
  return 'HIGH'
}

export function buildDecisionAction(insight: Insight): DecisionAction {
  let actionType = ACTION_TYPE_BY_INSIGHT_TYPE[insight.type] ?? 'REVIEW_METRIC'
  const economicImpact = insight.valueAtRisk
  if (
    (actionType === 'FOLLOW_UP' || actionType === 'RECOVER_STALLED') &&
    economicImpact != null &&
    economicImpact >= HIGH_VALUE_THRESHOLD
  ) {
    actionType = 'HIGH_VALUE_FOLLOW_UP'
  }
  return {
    actionType,
    reason: insight.type,
    priority: priorityFor(insight),
    entityIds: insight.entityIds,
    economicImpact,
  }
}

/** One DecisionAction per Insight, same order (buildInsights already
 *  sorted by priority) — a future Centro de Seguimiento consumer
 *  gets a ready-to-queue list without re-deriving anything. */
export function buildDecisionActions(insights: Insight[]): DecisionAction[] {
  return insights.map(buildDecisionAction)
}
