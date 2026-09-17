import type { CeoAlerts } from '../dashboard/ceo-types'
import type { SignalDraft } from './types'

// ============================================================
// Deterministic rules, fase 1 of the Risk Engine.
//
// Deliberately does NOT re-derive "stalled deal" / "at-risk customer"
// / "forecast short" from scratch — it re-packages the exact six
// checks `loadCeoAlerts` (src/lib/dashboard/ceo-queries.ts) already
// computes for the CEO dashboard, so a signal shown anywhere else in
// the product (a future Sales Command Center) never disagrees with
// the alert cards the dashboard already shows today. Severity
// thresholds below are new — loadCeoAlerts only ever reports "tripped
// or not" — calibrated conservatively so "high" reads as genuinely
// urgent, not just "technically nonzero".
//
// Pure function: no I/O, no Supabase client, so it's unit-tested with
// plain CeoAlerts objects rather than mocked queries.
// ============================================================

function round(n: number): number {
  return Math.round(n)
}

export function buildSignalsFromAlerts(alerts: CeoAlerts): SignalDraft[] {
  const signals: SignalDraft[] = []

  if (alerts.forecastGapPct != null) {
    const gap = Math.abs(alerts.forecastGapPct)
    signals.push({
      signalType: 'forecast_gap',
      severity: gap >= 25 ? 'high' : gap >= 10 ? 'medium' : 'low',
      valueAtRisk: null,
      metricValue: alerts.forecastGapPct,
      explanation: `El pronóstico de cierre está ${round(gap)}% por debajo de la meta del mes.`,
      evidence: { forecastGapPct: alerts.forecastGapPct },
    })
  }

  if (alerts.lowPipelineCoverage != null) {
    signals.push({
      signalType: 'low_pipeline_coverage',
      severity: alerts.lowPipelineCoverage < 1.5 ? 'high' : alerts.lowPipelineCoverage < 2.25 ? 'medium' : 'low',
      valueAtRisk: null,
      metricValue: alerts.lowPipelineCoverage,
      explanation: `El pipeline abierto cubre solo ${alerts.lowPipelineCoverage.toFixed(1)}x la meta mensual (mínimo saludable: 3x).`,
      evidence: { pipelineCoverage: alerts.lowPipelineCoverage },
    })
  }

  if (alerts.stalledCount > 0) {
    signals.push({
      signalType: 'stalled_deals',
      severity: alerts.stalledValue >= 50_000 ? 'high' : alerts.stalledValue >= 10_000 ? 'medium' : 'low',
      valueAtRisk: alerts.stalledValue,
      metricValue: alerts.stalledCount,
      explanation: `${alerts.stalledCount} trato(s) abiertos, con un valor potencial afectado de ${round(alerts.stalledValue)}, llevan más de una semana sin cambiar de etapa.`,
      evidence: { stalledCount: alerts.stalledCount, stalledValue: alerts.stalledValue },
    })
  }

  if (alerts.winRateDeclinePts != null) {
    signals.push({
      signalType: 'win_rate_decline',
      severity: alerts.winRateDeclinePts >= 15 ? 'high' : alerts.winRateDeclinePts >= 8 ? 'medium' : 'low',
      valueAtRisk: null,
      metricValue: alerts.winRateDeclinePts,
      explanation: `La tasa de cierre bajó ${round(alerts.winRateDeclinePts)} puntos frente al período anterior.`,
      evidence: { winRateDeclinePts: alerts.winRateDeclinePts },
    })
  }

  if (alerts.salesCycleIncreasePct != null) {
    signals.push({
      signalType: 'sales_cycle_increase',
      severity: alerts.salesCycleIncreasePct >= 40 ? 'high' : alerts.salesCycleIncreasePct >= 20 ? 'medium' : 'low',
      valueAtRisk: null,
      metricValue: alerts.salesCycleIncreasePct,
      explanation: `El ciclo de venta se alargó ${round(alerts.salesCycleIncreasePct)}% frente al período anterior.`,
      evidence: { salesCycleIncreasePct: alerts.salesCycleIncreasePct },
    })
  }

  if (alerts.atRiskCustomerCount > 0) {
    signals.push({
      signalType: 'at_risk_customers',
      severity: alerts.atRiskCustomerCount >= 10 ? 'high' : alerts.atRiskCustomerCount >= 4 ? 'medium' : 'low',
      valueAtRisk: null,
      metricValue: alerts.atRiskCustomerCount,
      explanation: `${alerts.atRiskCustomerCount} cliente(s) con un trato abierto llevan más de 14 días sin ningún mensaje.`,
      evidence: { atRiskCustomerCount: alerts.atRiskCustomerCount },
    })
  }

  return signals
}
