// ============================================================
// Centralized severity thresholds for the Risk Engine / Intelligence
// Layer (rules.ts, insights.ts) and Centro de Decisiones.
//
// Before this file, each threshold was a magic number inline at its
// one call site (rules.ts's own severity ternaries, a `count >= 5` in
// insights.ts). That made them hard to find, hard to compare against
// each other, and impossible to unit-test in isolation from the
// signal-building logic they gate. Every number here is otherwise
// UNCHANGED from what was already live — this is a relocation, not a
// recalibration.
//
// Pure data — no I/O, no dependency on anything else in this module.
// ============================================================

export const FORECAST_GAP_THRESHOLDS = { high: 25, medium: 10 } as const
export const PIPELINE_COVERAGE_THRESHOLDS = { high: 1.5, medium: 2.25 } as const
export const STALLED_VALUE_THRESHOLDS = { high: 50_000, medium: 10_000 } as const
export const WIN_RATE_DECLINE_THRESHOLDS = { high: 15, medium: 8 } as const
export const SALES_CYCLE_INCREASE_THRESHOLDS = { high: 40, medium: 20 } as const
export const AT_RISK_CUSTOMER_THRESHOLDS = { high: 10, medium: 4 } as const
export const BROKEN_PROMISES_THRESHOLDS = { high: 5, medium: 2 } as const
/** A HOT lead is escalated one severity notch above a generic
 *  at-risk-customer count (see insights.ts's own doc comment on
 *  `hotUnansweredSeverity`) — even a handful waiting is high, not
 *  medium, because they're customers with ACTIVE buying interest. */
export const HOT_UNANSWERED_THRESHOLDS = { high: 5 } as const

/** Three-tier severity picker: `high` at/above the high bound,
 *  `medium` at/above the medium bound, `low` otherwise. Shared by
 *  every threshold pair above so a signal's severity math reads the
 *  same way regardless of which metric it's gating. */
export function severityFromThresholds(
  value: number,
  thresholds: { high: number; medium: number },
): 'high' | 'medium' | 'low' {
  if (value >= thresholds.high) return 'high'
  if (value >= thresholds.medium) return 'medium'
  return 'low'
}

/** Pipeline coverage and win-rate-decline severity are INVERTED
 *  ("smaller coverage is worse", not "bigger is worse") — kept as a
 *  distinct helper rather than a flag on `severityFromThresholds` so
 *  every call site's direction is explicit at the call, not buried in
 *  a boolean. */
export function severityFromInvertedThresholds(
  value: number,
  thresholds: { high: number; medium: number },
): 'high' | 'medium' | 'low' {
  if (value < thresholds.high) return 'high'
  if (value < thresholds.medium) return 'medium'
  return 'low'
}
