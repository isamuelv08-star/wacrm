import type { SupabaseClient } from '@supabase/supabase-js'
import { loadCeoMetrics, loadCeoAlerts } from '../dashboard/ceo-queries'
import { rangeForPreset } from '../period'
import { buildBrokenPromiseSignal, buildSignalsFromAlerts } from './rules'
import { ALL_SIGNAL_TYPES } from './types'

// ============================================================
// Risk Engine scan — fase 1 of the Auditoría Saleslid roadmap.
//
// Invoked on a schedule via GET /api/cron/sales-intelligence (same
// shared-secret pattern as every other cron route in this app). For
// every active account, recomputes the same six checks the CEO
// dashboard already shows (loadCeoMetrics + loadCeoAlerts, both
// extended with an optional accountId param for exactly this loop —
// see their doc comments) and reconciles `sales_signals`:
//   - a check that's newly tripped opens one row,
//   - a check still tripped updates that row in place,
//   - a check that stopped tripping resolves it.
// Never more than one OPEN row per (account, signal_type) — enforced
// both by this reconciliation logic and by a partial unique index
// (migration 091), so a bug here fails loud instead of silently
// duplicating alerts.
//
// The range passed to loadCeoMetrics only affects goalAttainmentPct /
// salesThisMonth / newClients — none of which loadCeoAlerts reads —
// so "this month" is an arbitrary but harmless choice here.
// ============================================================

export interface RiskEngineScanResult {
  accountsScanned: number
  signalsOpened: number
  signalsUpdated: number
  signalsResolved: number
}

export async function runRiskEngineScan(db: SupabaseClient): Promise<RiskEngineScanResult> {
  const { data: accounts, error } = await db.from('accounts').select('id').eq('status', 'active')
  if (error) {
    console.error('[sales-intelligence] account scan failed:', error.message)
    return { accountsScanned: 0, signalsOpened: 0, signalsUpdated: 0, signalsResolved: 0 }
  }

  const range = rangeForPreset('thisMonth')
  let signalsOpened = 0
  let signalsUpdated = 0
  let signalsResolved = 0

  for (const account of (accounts ?? []) as { id: string }[]) {
    try {
      const metrics = await loadCeoMetrics(db, range, account.id)
      const alerts = await loadCeoAlerts(db, metrics, 7, 90, account.id)
      const drafts = buildSignalsFromAlerts(alerts)

      // Fase 5: fold in the one leak type that isn't already one of
      // the six CeoAlerts checks — promises (fase 4) that went
      // unfulfilled for this account.
      const { count: overdueCount, error: promisesErr } = await db
        .from('promises')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', account.id)
        .eq('status', 'overdue')
      if (promisesErr) {
        console.error('[sales-intelligence] overdue-promise count failed for account', account.id, promisesErr.message)
      } else {
        const brokenPromiseSignal = buildBrokenPromiseSignal(overdueCount ?? 0)
        if (brokenPromiseSignal) drafts.push(brokenPromiseSignal)
      }

      const draftTypes = new Set(drafts.map((d) => d.signalType))

      const { data: openRows, error: openErr } = await db
        .from('sales_signals')
        .select('id, signal_type')
        .eq('account_id', account.id)
        .eq('status', 'open')
      if (openErr) {
        console.error('[sales-intelligence] open-signal lookup failed for account', account.id, openErr.message)
        continue
      }
      const openIdByType = new Map<string, string>()
      for (const row of (openRows ?? []) as { id: string; signal_type: string }[]) {
        openIdByType.set(row.signal_type, row.id)
      }

      for (const draft of drafts) {
        const existingId = openIdByType.get(draft.signalType)
        if (existingId) {
          const { error: updErr } = await db
            .from('sales_signals')
            .update({
              severity: draft.severity,
              value_at_risk: draft.valueAtRisk,
              metric_value: draft.metricValue,
              explanation: draft.explanation,
              evidence: draft.evidence,
              updated_at: new Date().toISOString(),
            })
            .eq('id', existingId)
          if (updErr) console.error('[sales-intelligence] signal update failed:', updErr.message)
          else signalsUpdated++
        } else {
          const { error: insErr } = await db.from('sales_signals').insert({
            account_id: account.id,
            signal_type: draft.signalType,
            severity: draft.severity,
            source: 'rule',
            value_at_risk: draft.valueAtRisk,
            metric_value: draft.metricValue,
            explanation: draft.explanation,
            evidence: draft.evidence,
            status: 'open',
          })
          if (insErr) console.error('[sales-intelligence] signal insert failed:', insErr.message)
          else signalsOpened++
        }
      }

      for (const type of ALL_SIGNAL_TYPES) {
        if (draftTypes.has(type)) continue
        const existingId = openIdByType.get(type)
        if (!existingId) continue
        const { error: resErr } = await db
          .from('sales_signals')
          .update({
            status: 'resolved',
            resolved_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', existingId)
        if (resErr) console.error('[sales-intelligence] signal resolve failed:', resErr.message)
        else signalsResolved++
      }
    } catch (err) {
      console.error('[sales-intelligence] scan failed for account', account.id, err)
    }
  }

  return {
    accountsScanned: (accounts ?? []).length,
    signalsOpened,
    signalsUpdated,
    signalsResolved,
  }
}
