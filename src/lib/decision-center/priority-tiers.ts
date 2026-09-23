import type { Insight } from '@/lib/sales-intelligence/insights'
import type { DecisionAction } from '@/lib/sales-intelligence/decision-actions'

/**
 * Section 6's three-tier decision hierarchy (🔴 Actúa ahora / 🟠
 * Revisa hoy / 🟡 Vigila) — deliberately NOT a new priority system.
 * `decisionActions[i]` is the DecisionAction already derived from
 * `decisions[i]` (see decision-actions.ts / payload.ts, same order),
 * and its `priority` field is itself derived from the severity/
 * category `buildInsights` already computed. This function only
 * groups by that existing, already-tested field — no new threshold,
 * no re-derivation. Pure, no I/O.
 */
export interface DecisionTiers {
  /** 🔴 Actúa ahora — CRITICAL: high-severity signals in the
   *  "atención" bucket (loadCeoAlerts' own high thresholds, hot leads
   *  unanswered past the account's alert window). Direct loss/decay
   *  risk, per the brief's own examples. */
  actNow: Insight[]
  /** 🟠 Revisa hoy — HIGH: everything else that's urgent but not
   *  CRITICAL (medium/low severity risk signals, and the single
   *  top-ranked Next Best Action, which already earned HIGH by being
   *  the most urgent candidate in its own list). */
  reviewToday: Insight[]
  /** 🟡 Vigila — MEDIUM/LOW: the recovery opportunity and any
   *  low-severity signal. Not urgent by construction; worth knowing
   *  about, not worth interrupting the day for. */
  watch: Insight[]
}

export function groupDecisionsByTier(decisions: Insight[], decisionActions: DecisionAction[]): DecisionTiers {
  const tiers: DecisionTiers = { actNow: [], reviewToday: [], watch: [] }
  decisions.forEach((decision, i) => {
    const priority = decisionActions[i]?.priority
    if (priority === 'CRITICAL') tiers.actNow.push(decision)
    else if (priority === 'HIGH') tiers.reviewToday.push(decision)
    else tiers.watch.push(decision)
  })
  return tiers
}
