import type { SupabaseClient } from '@supabase/supabase-js'
import { monthKey, monthsAgoStart, lastNMonthKeys, daysAgoStart } from './date-utils'
import type {
  CeoAlerts,
  CeoMetrics,
  CommercialMetrics,
  FunnelStep,
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
// A trend (win rate, sales cycle) needs enough closed deals in BOTH
// windows to mean anything — below this, a couple of lucky/unlucky
// deals could swing the number 20+ points and the alert would just
// be noise.
const MIN_SAMPLES_FOR_TREND = 5
// "3x pipeline coverage" is a common sales-ops rule of thumb (roughly
// a third of pipeline converts), not something this account has
// configured — flagged here as a plain constant rather than a new
// Settings field, since the rest of the CEO dashboard already reads
// its real target (the monthly goal) wherever one exists.
const HEALTHY_PIPELINE_COVERAGE = 3
// A conversation with zero messages in this long, on a still-open
// deal, reads as a customer going cold — distinct from a deal simply
// not being moved between pipeline stages (that's `staleDays`).
const AT_RISK_CONVERSATION_SILENCE_DAYS = 14

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

// --- 5. Alerts -------------------------------------------------------------
//
// Six independent problem-detection checks. `metrics` is passed in
// (from `loadCeoMetrics`) rather than recomputed here, so the page
// doesn't re-run the same open-deals/forecast scan twice.

export async function loadCeoAlerts(db: DB, metrics: CeoMetrics, staleDays = 7): Promise<CeoAlerts> {
  const forecastGapPct = computeForecastGap(metrics.forecast, metrics.goalThisMonth)
  const lowPipelineCoverage =
    metrics.pipelineCoverage != null && metrics.pipelineCoverage < HEALTHY_PIPELINE_COVERAGE
      ? metrics.pipelineCoverage
      : null

  const trendWindowDays = 90
  const currentWindowStart = daysAgoStart(trendWindowDays).toISOString()
  const priorWindowStart = daysAgoStart(trendWindowDays * 2).toISOString()

  const [openDealsRes, trendRes, riskRes] = await Promise.all([
    db.from('deals').select('id, value').eq('status', 'open').limit(MAX_OPEN_DEALS_SCANNED),
    db
      .from('deals')
      .select('value, status, created_at, closed_at')
      .in('status', ['won', 'lost'])
      .gte('closed_at', priorWindowStart),
    db
      .from('deals')
      .select('id, conversation:conversations(last_message_at)')
      .eq('status', 'open')
      .not('conversation_id', 'is', null)
      .limit(MAX_OPEN_DEALS_SCANNED),
  ])
  if (openDealsRes.error) throw openDealsRes.error
  if (trendRes.error) throw trendRes.error
  if (riskRes.error) throw riskRes.error

  // --- stalled: open deals whose stage hasn't changed in `staleDays` ---
  const openDeals = (openDealsRes.data ?? []) as { id: string; value: number | null }[]
  let stalledCount = 0
  let stalledValue = 0
  if (openDeals.length > 0) {
    const { data: history, error: histErr } = await db
      .from('deal_stage_history')
      .select('deal_id, changed_at')
      .in(
        'deal_id',
        openDeals.map((d) => d.id),
      )
      .order('changed_at', { ascending: false })
    if (histErr) throw histErr

    // First row per deal_id wins — history is ordered newest first, so
    // that's each deal's most recent stage placement.
    const lastChangeByDeal = new Map<string, string>()
    for (const h of (history ?? []) as { deal_id: string; changed_at: string }[]) {
      if (!lastChangeByDeal.has(h.deal_id)) lastChangeByDeal.set(h.deal_id, h.changed_at)
    }

    const staleCutoff = Date.now() - staleDays * 86_400_000
    for (const d of openDeals) {
      const lastChange = lastChangeByDeal.get(d.id)
      // No history row shouldn't happen (the insert trigger always
      // writes one) — skip rather than guess if it's ever missing.
      if (!lastChange) continue
      if (new Date(lastChange).getTime() < staleCutoff) {
        stalledCount += 1
        stalledValue += d.value ?? 0
      }
    }
  }

  // --- win rate / sales cycle trend: current 90d vs. the 90d before it ---
  type TrendRow = { value: number | null; status: string; created_at: string; closed_at: string | null }
  const trendRows = (trendRes.data ?? []) as TrendRow[]
  const currentRows = trendRows.filter((r) => r.closed_at && r.closed_at >= currentWindowStart)
  const priorRows = trendRows.filter((r) => r.closed_at && r.closed_at < currentWindowStart)

  const winRatePctOf = (rows: TrendRow[]) =>
    rows.length > 0 ? (rows.filter((r) => r.status === 'won').length / rows.length) * 100 : null
  const avgCycleDaysOf = (rows: TrendRow[]) => {
    const won = rows.filter((r) => r.status === 'won' && r.closed_at)
    if (won.length === 0) return null
    const days = won
      .map((r) => (new Date(r.closed_at as string).getTime() - new Date(r.created_at).getTime()) / 86_400_000)
      .filter((n) => Number.isFinite(n) && n >= 0)
    return days.length > 0 ? days.reduce((s, n) => s + n, 0) / days.length : null
  }

  let winRateDeclinePts: number | null = null
  if (currentRows.length >= MIN_SAMPLES_FOR_TREND && priorRows.length >= MIN_SAMPLES_FOR_TREND) {
    const cur = winRatePctOf(currentRows)
    const prior = winRatePctOf(priorRows)
    // Only a real decline (not noise, not an improvement) counts as an alert.
    if (cur != null && prior != null && prior - cur >= 3) winRateDeclinePts = prior - cur
  }

  let salesCycleIncreasePct: number | null = null
  const currentWonCount = currentRows.filter((r) => r.status === 'won').length
  const priorWonCount = priorRows.filter((r) => r.status === 'won').length
  if (currentWonCount >= MIN_SAMPLES_FOR_TREND && priorWonCount >= MIN_SAMPLES_FOR_TREND) {
    const cur = avgCycleDaysOf(currentRows)
    const prior = avgCycleDaysOf(priorRows)
    if (cur != null && prior != null && prior > 0 && cur > prior * 1.1) {
      salesCycleIncreasePct = ((cur - prior) / prior) * 100
    }
  }

  // --- at-risk customers: open deals whose conversation has gone quiet ---
  type RiskRow = {
    id: string
    conversation: { last_message_at: string | null }[] | { last_message_at: string | null } | null
  }
  const riskCutoff = Date.now() - AT_RISK_CONVERSATION_SILENCE_DAYS * 86_400_000
  let atRiskCustomerCount = 0
  for (const d of (riskRes.data ?? []) as unknown as RiskRow[]) {
    const conv = Array.isArray(d.conversation) ? d.conversation[0] : d.conversation
    const lastMessageAt = conv?.last_message_at
    if (!lastMessageAt || new Date(lastMessageAt).getTime() < riskCutoff) {
      atRiskCustomerCount += 1
    }
  }

  return {
    stalledCount,
    stalledValue,
    forecastGapPct,
    atRiskCustomerCount,
    winRateDeclinePts,
    salesCycleIncreasePct,
    lowPipelineCoverage,
  }
}

function computeForecastGap(forecast: number, goal: number | null): number | null {
  if (!goal) return null
  const pct = ((forecast - goal) / goal) * 100
  // Only surface as an alert when the forecast is actually short.
  return pct < 0 ? pct : null
}

// --- 6. Sales funnel: leads -> each pipeline stage -> won -----------------

/**
 * Conversion funnel, not a current-state snapshot (that's
 * `loadPipelineDonut`) — each stage's count is how many distinct
 * deals REACHED it during the window per `deal_stage_history`, so a
 * deal that has since moved on (or closed) still counts at every
 * stage it passed through. That's what makes stage-to-stage drop-off
 * meaningful instead of just "how many deals happen to be here now".
 */
export async function loadSalesFunnel(db: DB, days = 90): Promise<FunnelStep[]> {
  const windowStart = daysAgoStart(days).toISOString()

  const [stagesRes, leadsRes, historyRes, dealValuesRes, wonRes] = await Promise.all([
    db.from('pipeline_stages').select('id, name').order('position'),
    db.from('contacts').select('id', { count: 'exact', head: true }).gte('created_at', windowStart),
    db.from('deal_stage_history').select('deal_id, to_stage_id').gte('changed_at', windowStart),
    db.from('deals').select('id, value'),
    db.from('deals').select('value').eq('status', 'won').gte('closed_at', windowStart),
  ])
  if (stagesRes.error) throw stagesRes.error
  if (leadsRes.error) throw leadsRes.error
  if (historyRes.error) throw historyRes.error
  if (dealValuesRes.error) throw dealValuesRes.error
  if (wonRes.error) throw wonRes.error

  const valueByDeal = new Map<string, number>()
  for (const d of (dealValuesRes.data ?? []) as { id: string; value: number | null }[]) {
    valueByDeal.set(d.id, d.value ?? 0)
  }

  const dealsByStage = new Map<string, Set<string>>()
  for (const h of (historyRes.data ?? []) as { deal_id: string; to_stage_id: string }[]) {
    const set = dealsByStage.get(h.to_stage_id) ?? new Set<string>()
    set.add(h.deal_id)
    dealsByStage.set(h.to_stage_id, set)
  }

  const stages = (stagesRes.data ?? []) as { id: string; name: string }[]
  const stageSteps: FunnelStep[] = stages.map((s) => {
    const dealIds = dealsByStage.get(s.id) ?? new Set<string>()
    let value = 0
    for (const id of dealIds) value += valueByDeal.get(id) ?? 0
    return { key: s.id, label: s.name, count: dealIds.size, value }
  })

  const wonRows = (wonRes.data ?? []) as { value: number | null }[]
  const leadsStep: FunnelStep = { key: 'leads', label: '', count: leadsRes.count ?? 0, value: null }
  const wonStep: FunnelStep = {
    key: 'won',
    label: '',
    count: wonRows.length,
    value: wonRows.reduce((s, r) => s + (r.value ?? 0), 0),
  }

  return [leadsStep, ...stageSteps, wonStep]
}
