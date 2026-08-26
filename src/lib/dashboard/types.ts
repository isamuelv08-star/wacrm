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
