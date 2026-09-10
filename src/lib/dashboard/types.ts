// Shared result shapes the dashboard components consume. Centralised
// here so each component stays thin and the page-level loader wires
// them up without type gymnastics.

export interface MetricDelta {
  current: number
  previous: number
}

export interface MetricsBundle {
  activeConversations: MetricDelta
  newContactsToday: MetricDelta
  openDealsValue: number
  openDealsCount: number
  messagesSentToday: MetricDelta
}

export interface ConversationsSeriesPoint {
  day: string // YYYY-MM-DD local
  incoming: number
  outgoing: number
}

export interface PipelineStageSlice {
  id: string
  name: string
  color: string
  dealCount: number
  totalValue: number
}

export interface PipelineDonutData {
  stages: PipelineStageSlice[]
  totalValue: number
}

export interface ResponseTimeBucket {
  /** Short display label for this bucket's start day (e.g. "Aug 12"). */
  label: string
  /** Average first-response time in minutes. Null means no samples. */
  avgMinutes: number | null
  samples: number
}

export interface ResponseTimeSummary {
  buckets: ResponseTimeBucket[]
  /** Average across the selected range. */
  currentAvg: number | null
  /** Average across the equal-length window immediately before it. */
  previousAvg: number | null
}

/** Today's lead-qualification breakdown for the dashboard's "Leads
 *  qualified today" card — counts contacts the AI (or a manual
 *  override) actually assessed since local midnight, by lead_score. */
export interface LeadsQualifiedToday {
  hot: number
  warm: number
  cold: number
}

/** A HOT-scored lead whose conversation has gone unanswered past the
 *  account's response-time window — the "Juana +15m sin respuesta"
 *  card. Mirrors the candidate shape `runHotLeadAlertScan` (the cron
 *  job) already scans for, but read-only and dashboard-scoped. */
export interface HotUnansweredItem {
  conversationId: string
  contactName: string
  /** Minutes since the customer's last (still-unanswered) message. */
  waitingMinutes: number
}

/**
 * A lead sitting in a pipeline's "Seguimiento" stage (a stage flagged
 * `is_followup_stage`, migration 077) — received info and went quiet.
 * Powers the Dashboard/Pipeline "Seguimiento" cards, grouped by the
 * contact's existing hot/warm/cold `lead_score`.
 */
export interface FollowupLeadItem {
  dealId: string
  contactId: string | null
  contactName: string | null
  phone: string | null
  conversationId: string | null
  pipelineId: string
  pipelineName: string
  stageId: string
  stageName: string
  /** Days since the deal landed in this stage (from `deal_stage_history`,
   *  migration 039) — how long it's been waiting for a retry. */
  daysInStage: number
}

export type FollowupScore = 'hot' | 'warm' | 'cold'

export interface FollowupSummary {
  hot: FollowupLeadItem[]
  warm: FollowupLeadItem[]
  cold: FollowupLeadItem[]
}
