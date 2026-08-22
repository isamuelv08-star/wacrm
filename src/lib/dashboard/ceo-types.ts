// Result shapes for the CEO dashboard (/ceo) — kept separate from
// ./types.ts (the operational /dashboard) since the two pages share
// no queries and this set leans on data (sales_goals, win_probability,
// deals.closed_at) that only exists for this panel.

import type { MetricDelta } from './types'

export interface SalesVsGoalPoint {
  /** First of the month, "YYYY-MM-01". */
  month: string
  /** Sum of won deals whose closed_at falls in this month. */
  actual: number
  /** The account-level goal for this month. Null if never set. */
  goal: number | null
}

export interface CeoMetrics {
  /** Revenue from deals won this month, vs. last month. */
  salesThisMonth: MetricDelta
  /** This month's account-level goal. Null if never set. */
  goalThisMonth: number | null
  /** salesThisMonth.current / goalThisMonth, as a 0-100+ percent. Null if no goal is set. */
  goalAttainmentPct: number | null
  /** Sum of value across all open deals. */
  pipelineTotal: number
  /** pipelineTotal / goalThisMonth — "the pipeline is Nx the goal". Null if no goal is set. */
  pipelineCoverage: number | null
  /** Open pipeline weighted by each deal's stage win_probability. */
  forecast: number
  /** forecast / goalThisMonth, as a percent. Null if no goal is set. */
  forecastPct: number | null
  /** Distinct contacts with at least one deal, created this month vs last month. */
  newClients: MetricDelta
  /** Distinct contacts with at least one deal, all time. */
  totalClients: number
}

export interface CommercialMetrics {
  /** won / (won + lost) among deals closed in the trailing window, as 0-100. Null with no closed deals. */
  winRatePct: number | null
  /** Average value of won deals in the trailing window. */
  avgTicket: number
  /** Average days from creation to close, won deals in the trailing window. Null with no samples. */
  avgSalesCycleDays: number | null
}

export interface TopSeller {
  userId: string
  name: string
  /** Value of this member's won deals this month. */
  soldThisMonth: number
  /** This member's individual goal for the month. Null if never set. */
  goal: number | null
  /** soldThisMonth / goal, as a percent. Null if no individual goal is set. */
  attainmentPct: number | null
}

export interface CeoAlerts {
  /** Open deals whose most recent stage change is older than the stale threshold. */
  stalledCount: number
  /** Sum of value across those stalled deals. */
  stalledValue: number
  /** (forecast - goal) / goal as a percent — only meaningful (and only
   *  ever shown) when negative, i.e. the forecast is short of goal.
   *  Null if no goal is set. */
  forecastGapPct: number | null
}
