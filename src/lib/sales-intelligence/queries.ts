import type { SupabaseClient } from '@supabase/supabase-js'
import { findAtRiskOpenDeals, findStalledOpenDeals } from '../dashboard/ceo-queries'
import { aggregateMoneyAtRisk, type MoneyAtRiskData } from './aggregate'
import { buildNextBestActions, type NextBestAction } from './next-best-action'

const DEFAULT_STALE_DAYS = 7
const DEFAULT_SILENCE_DAYS = 14

// ============================================================
// Money at Risk (fase 2) — "dónde se escapa el valor", broken down by
// seller and by pipeline stage. Deliberately built on top of
// findStalledOpenDeals (src/lib/dashboard/ceo-queries.ts), the exact
// same "stalled deal" definition CeoAlerts.stalledValue already uses,
// so this card's total always agrees with the CEO dashboard's own
// alert — it's a breakdown of that number, not a second opinion on it.
//
// Client-side query (RLS-scoped, like every other src/lib/dashboard
// loader) — no accountId param, unlike the risk-engine's per-account
// service-role loop.
// ============================================================

export async function loadMoneyAtRisk(db: SupabaseClient, staleDays = 7): Promise<MoneyAtRiskData> {
  const stalled = await findStalledOpenDeals(db, staleDays)
  if (stalled.length === 0) {
    return aggregateMoneyAtRisk([], new Map(), new Map())
  }

  const sellerIds = [...new Set(stalled.map((d) => d.assignedTo).filter((id): id is string => !!id))]
  const stageIds = [...new Set(stalled.map((d) => d.stageId).filter((id): id is string => !!id))]

  const [sellersRes, stagesRes] = await Promise.all([
    sellerIds.length > 0
      ? db.from('profiles').select('id, full_name, email').in('id', sellerIds)
      : Promise.resolve({ data: [] as unknown[], error: null }),
    stageIds.length > 0
      ? db.from('pipeline_stages').select('id, name').in('id', stageIds)
      : Promise.resolve({ data: [] as unknown[], error: null }),
  ])
  if (sellersRes.error) throw sellersRes.error
  if (stagesRes.error) throw stagesRes.error

  const sellerNameById = new Map<string, string>()
  for (const s of (sellersRes.data ?? []) as { id: string; full_name: string | null; email: string | null }[]) {
    sellerNameById.set(s.id, s.full_name || s.email || '—')
  }
  const stageNameById = new Map<string, string>()
  for (const s of (stagesRes.data ?? []) as { id: string; name: string }[]) {
    stageNameById.set(s.id, s.name)
  }

  return aggregateMoneyAtRisk(stalled, sellerNameById, stageNameById)
}

export interface NextBestActionDisplay extends NextBestAction {
  contactName: string | null
  contactPhone: string | null
  assigneeName: string | null
}

/**
 * Fetches the two per-deal signal lists (same "stalled"/"at-risk"
 * definitions Money at Risk uses), ranks them via `buildNextBestActions`,
 * and resolves display names for whatever made the cut — never for
 * every candidate, since the cap keeps that list short.
 */
export async function loadNextBestActions(
  db: SupabaseClient,
  staleDays = DEFAULT_STALE_DAYS,
  silenceDays = DEFAULT_SILENCE_DAYS,
): Promise<NextBestActionDisplay[]> {
  const [stalled, atRisk] = await Promise.all([
    findStalledOpenDeals(db, staleDays),
    findAtRiskOpenDeals(db, silenceDays),
  ])
  const actions = buildNextBestActions(stalled, atRisk)
  if (actions.length === 0) return []

  const contactIds = [...new Set(actions.map((a) => a.contactId).filter((id): id is string => !!id))]
  const sellerIds = [...new Set(actions.map((a) => a.assignedTo).filter((id): id is string => !!id))]

  const [contactsRes, sellersRes] = await Promise.all([
    contactIds.length > 0
      ? db.from('contacts').select('id, name, phone').in('id', contactIds)
      : Promise.resolve({ data: [] as unknown[], error: null }),
    sellerIds.length > 0
      ? db.from('profiles').select('id, full_name, email').in('id', sellerIds)
      : Promise.resolve({ data: [] as unknown[], error: null }),
  ])
  if (contactsRes.error) throw contactsRes.error
  if (sellersRes.error) throw sellersRes.error

  const contactById = new Map<string, { name: string | null; phone: string }>()
  for (const c of (contactsRes.data ?? []) as { id: string; name: string | null; phone: string }[]) {
    contactById.set(c.id, { name: c.name, phone: c.phone })
  }
  const sellerNameById = new Map<string, string>()
  for (const s of (sellersRes.data ?? []) as { id: string; full_name: string | null; email: string | null }[]) {
    sellerNameById.set(s.id, s.full_name || s.email || '—')
  }

  return actions.map((a) => {
    const contact = a.contactId ? contactById.get(a.contactId) : undefined
    return {
      ...a,
      contactName: contact?.name ?? null,
      contactPhone: contact?.phone ?? null,
      assigneeName: a.assignedTo ? (sellerNameById.get(a.assignedTo) ?? null) : null,
    }
  })
}
