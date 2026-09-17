// ============================================================
// Shared types for the sales-intelligence Risk Engine (fase 1 of the
// Auditoría Saleslid roadmap). Kept in their own file since both
// rules.ts (pure, unit-tested) and risk-engine.ts (DB orchestration)
// need them, and neither should import from the other.
// ============================================================

/** Mirrors the CHECK constraint on sales_signals.signal_type
 *  (migration 091) — one value per check already surfaced by
 *  loadCeoAlerts (src/lib/dashboard/ceo-queries.ts). */
export type SignalType =
  | 'forecast_gap'
  | 'low_pipeline_coverage'
  | 'stalled_deals'
  | 'win_rate_decline'
  | 'sales_cycle_increase'
  | 'at_risk_customers'

export type SignalSeverity = 'low' | 'medium' | 'high'

/** What a rule produces for one account, before it's written to (or
 *  reconciled against) `sales_signals` — deliberately DB-agnostic so
 *  the rules themselves can be unit-tested with plain objects. */
export interface SignalDraft {
  signalType: SignalType
  severity: SignalSeverity
  /** "Valor potencial afectado" in the account's currency — null for
   *  signals measured in points/percent/count rather than money. */
  valueAtRisk: number | null
  /** The raw number the signal is about, alongside `explanation`. */
  metricValue: number | null
  /** One human-readable sentence — always shown, never a bare score
   *  (mandatory explainability, per the Auditoría Saleslid). */
  explanation: string
  evidence: Record<string, unknown>
}

export const ALL_SIGNAL_TYPES: SignalType[] = [
  'forecast_gap',
  'low_pipeline_coverage',
  'stalled_deals',
  'win_rate_decline',
  'sales_cycle_increase',
  'at_risk_customers',
]
