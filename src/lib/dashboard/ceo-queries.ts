import type { SupabaseClient } from '@supabase/supabase-js'
import { monthKey, monthsAgoStart, lastNMonthKeys, daysAgoStart } from './date-utils'
import type {
  CeoAlerts,
  CeoMetrics,
  CommercialMetrics,
  SalesVsGoalPoint,
  TopSeller,
} from './ceo-types'

// ------------------------------------------------------------
// Client-side aggregation, same posture as ./queries.ts — RLS scopes
// every query to the caller's account automatically (is_account_member),
// so nothing here passes account_id explicitly.
// ------------------------------------------------------------

type DB = SupabaseClient

const MAX_OPEN_DEALS_SCANNED = 500

// --- 1. Sales vs goal, monthly series -----------------------------------

export async function loadSalesVsGoal(db: DB, months = 6): Promise<SalesVsGoalPoint[]> {
  const monthKeys = lastNMonthKeys(months)
  const rangeStart = monthsAgoStart(months - 1).toISOString()

  const [dealsRes, goalsRes] = await Promise.all([
    db
      .from('deals')
      .select('value, closed_at')
      .eq('status', 'won')
      .gte('closed_at', rangeStart),
    db
      .from('sales_goals')
      .select('period_month, target_value')
      .is('user_id', null)
      .gte('period_month', monthKeys[0]),
  ])
  if (dealsRes.error) throw dealsRes.error
  if (goalsRes.error) throw goalsRes.error

  const actualByMonth = new Map<string, number>()
  for (const k of monthKeys) actualByMonth.set(k, 0)
  for (const d of (dealsRes.data ?? []) as { value: number | null; closed_at: string }[]) {
    const key = monthKey(d.closed_at)
    if (actualByMonth.has(key)) {
      actualByMonth.set(key, (actualByMonth.get(key) ?? 0) + (d.value ?? 0))
    }
  }

  const goalByMonth = new Map<string, number>()
  for (const g of (goalsRes.data ?? []) as { period_month: string; target_value: number }[]) {
    goalByMonth.set(g.period_month, g.target_value)
  }

  return monthKeys.map((m) => ({
    month: m,
    actual: actualByMonth.get(m) ?? 0,
    goal: goalByMonth.get(m) ?? null,
  }))
}

// --- 2. Headline KPIs -----------------------------------------------------

export async function loadCeoMetrics(db: DB): Promise<CeoMetrics> {
  const thisMonthKey = monthKey(new Date())
  const thisMonthStart = monthsAgoStart(0).toISOString()
  const lastMonthStart = monthsAgoStart(1).toISOString()

  type OpenDealRow = {
    value: number | null
    stage:
      | { win_probability: number | null }[]
      | { win_probability: number | null }
      | null
  }
  type ContactRow = { contact_id: string | null }

  const [
    wonThisMonth,
    wonLastMonth,
    goalRow,
    openDeals,
    contactsAll,
    contactsThisMonth,
    contactsLastMonth,
  ] = await Promise.all([
    db.from('deals').select('value').eq('status', 'won').gte('closed_at', thisMonthStart),
    db
      .from('deals')
      .select('value')
      .eq('status', 'won')
      .gte('closed_at', lastMonthStart)
      .lt('closed_at', thisMonthStart),
    db
      .from('sales_goals')
      .select('target_value')
      .is('user_id', null)
      .eq('period_month', thisMonthKey)
      .maybeSingle(),
    db
      .from('deals')
      .select('value, stage:pipeline_stages(win_probability)')
      .eq('status', 'open')
      .limit(MAX_OPEN_DEALS_SCANNED),
    db.from('deals').select('contact_id').not('contact_id', 'is', null),
    db
      .from('deals')
      .select('contact_id')
      .not('contact_id', 'is', null)
      .gte('created_at', thisMonthStart),
    db
      .from('deals')
      .select('contact_id')
      .not('contact_id', 'is', null)
      .gte('created_at', lastMonthStart)
      .lt('created_at', thisMonthStart),
  ])

  for (const r of [wonThisMonth, wonLastMonth, goalRow, openDeals, contactsAll, contactsThisMonth, contactsLastMonth]) {
    if (r.error) throw r.error
  }

  const sum = (rows: { value: number | null }[]) =>
    rows.reduce((s, r) => s + (r.value ?? 0), 0)
  const salesThisMonthValue = sum((wonThisMonth.data ?? []) as { value: number | null }[])
  const salesLastMonthValue = sum((wonLastMonth.data ?? []) as { value: number | null }[])

  let pipelineTotal = 0
  let forecast = 0
  for (const d of (openDeals.data ?? []) as unknown as OpenDealRow[]) {
    const value = d.value ?? 0
    pipelineTotal += value
    const stage = Array.isArray(d.stage) ? d.stage[0] : d.stage
    const prob = stage?.win_probability
    if (prob != null) forecast += value * (prob / 100)
  }

  const distinctContacts = (rows: ContactRow[]) =>
    new Set(rows.map((r) => r.contact_id).filter((id): id is string => !!id)).size
  const totalClients = distinctContacts((contactsAll.data ?? []) as ContactRow[])
  const newClientsThisMonth = distinctContacts((contactsThisMonth.data ?? []) as ContactRow[])
  const newClientsLastMonth = distinctContacts((contactsLastMonth.data ?? []) as ContactRow[])

  const goalThisMonth = (goalRow.data as { target_value: number } | null)?.target_value ?? null

  return {
    salesThisMonth: { current: salesThisMonthValue, previous: salesLastMonthValue },
    goalThisMonth,
    goalAttainmentPct: goalThisMonth ? (salesThisMonthValue / goalThisMonth) * 100 : null,
    pipelineTotal,
    pipelineCoverage: goalThisMonth ? pipelineTotal / goalThisMonth : null,
    forecast,
    forecastPct: goalThisMonth ? (forecast / goalThisMonth) * 100 : null,
    newClients: { current: newClientsThisMonth, previous: newClientsLastMonth },
    totalClients,
  }
}

// --- 3. Commercial metrics (win rate, avg ticket, sales cycle) -----------

export async function loadCommercialMetrics(db: DB, windowDays = 90): Promise<CommercialMetrics> {
  const start = daysAgoStart(windowDays).toISOString()
  const { data, error } = await db
    .from('deals')
    .select('value, status, created_at, closed_at')
    .in('status', ['won', 'lost'])
    .gte('closed_at', start)
  if (error) throw error

  const rows = (data ?? []) as { value: number | null; status: string; created_at: string; closed_at: string | null }[]
  const won = rows.filter((r) => r.status === 'won')

  const winRatePct = rows.length > 0 ? (won.length / rows.length) * 100 : null
  const avgTicket = won.length > 0 ? won.reduce((s, d) => s + (d.value ?? 0), 0) / won.length : 0

  const cycles = won
    .filter((d) => d.closed_at)
    .map((d) => (new Date(d.closed_at as string).getTime() - new Date(d.created_at).getTime()) / 86_400_000)
    .filter((n) => Number.isFinite(n) && n >= 0)
  const avgSalesCycleDays = cycles.length > 0 ? cycles.reduce((s, n) => s + n, 0) / cycles.length : null

  return { winRatePct, avgTicket, avgSalesCycleDays }
}

// --- 4. Top sellers vs their individual goal ------------------------------

export async function loadTopSellers(db: DB, limit = 5): Promise<TopSeller[]> {
  const thisMonthKey = monthKey(new Date())
  const thisMonthStart = monthsAgoStart(0).toISOString()

  const [membersRes, dealsRes, goalsRes] = await Promise.all([
    db.from('profiles').select('user_id, full_name, email'),
    db
      .from('deals')
      .select('assigned_to, value')
      .eq('status', 'won')
      .gte('closed_at', thisMonthStart)
      .not('assigned_to', 'is', null),
    db
      .from('sales_goals')
      .select('user_id, target_value')
      .eq('period_month', thisMonthKey)
      .not('user_id', 'is', null),
  ])
  if (membersRes.error) throw membersRes.error
  if (dealsRes.error) throw dealsRes.error
  if (goalsRes.error) throw goalsRes.error

  const soldByUser = new Map<string, number>()
  for (const d of (dealsRes.data ?? []) as { assigned_to: string; value: number | null }[]) {
    soldByUser.set(d.assigned_to, (soldByUser.get(d.assigned_to) ?? 0) + (d.value ?? 0))
  }
  const goalByUser = new Map<string, number>()
  for (const g of (goalsRes.data ?? []) as { user_id: string; target_value: number }[]) {
    goalByUser.set(g.user_id, g.target_value)
  }

  const members = (membersRes.data ?? []) as { user_id: string; full_name: string | null; email: string | null }[]

  return members
    // Only members who actually sold something this month, or have a
    // quota set — otherwise every viewer/admin with zero deals would
    // clutter what's meant to be a sales leaderboard.
    .filter((m) => soldByUser.has(m.user_id) || goalByUser.has(m.user_id))
    .map((m) => {
      const soldThisMonth = soldByUser.get(m.user_id) ?? 0
      const goal = goalByUser.get(m.user_id) ?? null
      return {
        userId: m.user_id,
        name: m.full_name || m.email || '—',
        soldThisMonth,
        goal,
        attainmentPct: goal ? (soldThisMonth / goal) * 100 : null,
      }
    })
    .sort((a, b) => {
      if (a.attainmentPct != null && b.attainmentPct != null) return b.attainmentPct - a.attainmentPct
      if (a.attainmentPct != null) return -1
      if (b.attainmentPct != null) return 1
      return b.soldThisMonth - a.soldThisMonth
    })
    .slice(0, limit)
}

// --- 5. Alerts: stalled deals + forecast shortfall ------------------------

/**
 * `forecast` and `goalThisMonth` are passed in (from `loadCeoMetrics`)
 * rather than recomputed here, so the page doesn't run the same
 * open-deals scan twice.
 */
export async function loadCeoAlerts(
  db: DB,
  forecast: number,
  goalThisMonth: number | null,
  staleDays = 7,
): Promise<CeoAlerts> {
  const forecastGapPct = computeForecastGap(forecast, goalThisMonth)

  const { data: openDeals, error } = await db
    .from('deals')
    .select('id, value')
    .eq('status', 'open')
    .limit(MAX_OPEN_DEALS_SCANNED)
  if (error) throw error

  const deals = (openDeals ?? []) as { id: string; value: number | null }[]
  if (deals.length === 0) {
    return { stalledCount: 0, stalledValue: 0, forecastGapPct }
  }

  const { data: history, error: histErr } = await db
    .from('deal_stage_history')
    .select('deal_id, changed_at')
    .in(
      'deal_id',
      deals.map((d) => d.id),
    )
    .order('changed_at', { ascending: false })
  if (histErr) throw histErr

  // First row per deal_id wins — history is ordered newest first, so
  // that's each deal's most recent stage placement.
  const lastChangeByDeal = new Map<string, string>()
  for (const h of (history ?? []) as { deal_id: string; changed_at: string }[]) {
    if (!lastChangeByDeal.has(h.deal_id)) lastChangeByDeal.set(h.deal_id, h.changed_at)
  }

  const cutoff = Date.now() - staleDays * 86_400_000
  let stalledCount = 0
  let stalledValue = 0
  for (const d of deals) {
    const lastChange = lastChangeByDeal.get(d.id)
    // No history row shouldn't happen (the insert trigger always
    // writes one) — skip rather than guess if it's ever missing.
    if (!lastChange) continue
    if (new Date(lastChange).getTime() < cutoff) {
      stalledCount += 1
      stalledValue += d.value ?? 0
    }
  }

  return { stalledCount, stalledValue, forecastGapPct }
}

function computeForecastGap(forecast: number, goal: number | null): number | null {
  if (!goal) return null
  const pct = ((forecast - goal) / goal) * 100
  // Only surface as an alert when the forecast is actually short.
  return pct < 0 ? pct : null
}
