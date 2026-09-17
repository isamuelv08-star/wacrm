import type { StalledOpenDeal } from '../dashboard/ceo-queries'

// ============================================================
// Pure aggregation for the Money at Risk card (fase 2). Split out from
// queries.ts (the DB-fetching shell) for the same reason rules.ts is
// separate from risk-engine.ts: no I/O here, so it's unit-tested with
// plain objects instead of a mocked Supabase client.
// ============================================================

export interface MoneyAtRiskBreakdownRow {
  key: string
  /** Null when this bucket has no name — an unassigned seller, or a
   *  stage id that didn't resolve — so the UI renders its own
   *  localized fallback instead of this layer hardcoding one language. */
  label: string | null
  value: number
  count: number
}

export interface MoneyAtRiskData {
  /** Same figure as `CeoAlerts.stalledValue` — this card breaks that
   *  one number down by seller and stage, it doesn't recompute it. */
  totalValue: number
  totalCount: number
  bySeller: MoneyAtRiskBreakdownRow[]
  byStage: MoneyAtRiskBreakdownRow[]
}

const UNASSIGNED_KEY = '__unassigned__'
const UNKNOWN_STAGE_KEY = '__unknown_stage__'

export function aggregateMoneyAtRisk(
  stalled: StalledOpenDeal[],
  sellerNameById: Map<string, string>,
  stageNameById: Map<string, string>,
): MoneyAtRiskData {
  const bySellerMap = new Map<string, { label: string | null; value: number; count: number }>()
  const byStageMap = new Map<string, { label: string | null; value: number; count: number }>()

  let totalValue = 0
  for (const d of stalled) {
    const value = d.value ?? 0
    totalValue += value

    const sellerKey = d.assignedTo ?? UNASSIGNED_KEY
    const sellerEntry = bySellerMap.get(sellerKey) ?? {
      label: d.assignedTo ? (sellerNameById.get(d.assignedTo) ?? null) : null,
      value: 0,
      count: 0,
    }
    sellerEntry.value += value
    sellerEntry.count += 1
    bySellerMap.set(sellerKey, sellerEntry)

    const stageKey = d.stageId ?? UNKNOWN_STAGE_KEY
    const stageEntry = byStageMap.get(stageKey) ?? {
      label: d.stageId ? (stageNameById.get(d.stageId) ?? null) : null,
      value: 0,
      count: 0,
    }
    stageEntry.value += value
    stageEntry.count += 1
    byStageMap.set(stageKey, stageEntry)
  }

  const toSortedRows = (
    map: Map<string, { label: string | null; value: number; count: number }>,
  ): MoneyAtRiskBreakdownRow[] =>
    [...map.entries()]
      .map(([key, v]) => ({ key, label: v.label, value: v.value, count: v.count }))
      .sort((a, b) => b.value - a.value)

  return {
    totalValue,
    totalCount: stalled.length,
    bySeller: toSortedRows(bySellerMap),
    byStage: toSortedRows(byStageMap),
  }
}
