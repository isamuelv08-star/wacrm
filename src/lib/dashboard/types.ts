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

export type ActivityKind = "message" | "contact" | "deal" | "broadcast" | "automation";

/** One row in the dashboard's "recent activity" feed. `subject` /
 *  `detail` are raw data (a contact's name, a deal's formatted value,
 *  …) — the component composes them into a localized sentence via
 *  `Dashboard.activityFeed.items.*`, so this type stays translation-
 *  free like every other query result here. */
export interface ActivityItem {
  id: string;
  kind: ActivityKind;
  /** ISO timestamp. */
  at: string;
  href?: string;
  /** Primary label: contact name, deal title, broadcast/automation name. */
  subject: string;
  /** Optional secondary detail: message snippet, formatted deal value, related contact. */
  detail?: string;
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
