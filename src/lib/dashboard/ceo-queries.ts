import type { SupabaseClient } from '@supabase/supabase-js'
import {
  monthKey,
  daysAgoStart,
  daysInMonthOf,
  previousRangeStart,
  rangeBuckets,
  rangeStart,
} from './date-utils'
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

// --- 1. Sales vs goal, over the selected range --------------------------

/**
 * Buckets the selected range (daily for ≤30 days, ~30 multi-day
 * buckets for 6 months / 1 year — see `rangeBuckets`) and compares
 * actual won-deal revenue per bucket against a slice of the account's
 * CURRENT monthly goal, prorated by the bucket's own day count. There's
 * only ever one goal on the books (this month's), so a 1-year view
 * necessarily assumes "if every month kept pace with this one" rather
 * than replaying whatever the goal actually was in each past month —
 * simpler and still a meaningful trend line, but worth knowing it's a
 * projection for anything beyond the current month.
 */
export async function loadSalesVsGoal(db: DB, rangeDays: number): Promise<SalesVsGoalPoint[]> {
  const currentStart = rangeStart(rangeDays)
  const buckets = rangeBuckets(rangeDays)

  const [dealsRes, goalRow] = await Promise.all([
    db
      .from('deals')
      .select('value, closed_at')
      .eq('status', 'won')
      .gte('closed_at', currentStart.toISOString()),
    db
      .from('sales_goals')
      .select('target_value')
      .is('user_id', null)
      .eq('period_month', monthKey(new Date()))
      .maybeSingle(),
  ])
  if (dealsRes.error) throw dealsRes.error
  if (goalRow.error) throw goalRow.error

  const rows = (dealsRes.data ?? []) as { value: number | null; closed_at: string }[]
  const monthlyGoal = (goalRow.data as { target_value: number } | null)?.target_value ?? null
  const goalPerDay = monthlyGoal != null ? monthlyGoal / daysInMonthOf(new Date()) : null

  return buckets.map((b) => {
    const actual = rows
      .filter((d) => {
        const t = new Date(d.closed_at).getTime()
        return t >= b.start.getTime() && t < b.end.getTime()
      })
      .reduce((s, d) => s + (d.value ?? 0), 0)
    const bucketDays = Math.max(1, Math.round((b.end.getTime() - b.start.getTime()) / 86_400_000))
    return {
      label: b.label,
      actual,
      goal: goalPerDay != null ? goalPerDay * bucketDays : null,
    }
  })
}

// --- 2. Headline KPIs -----------------------------------------------------

/**
 * `salesThisMonth`/`newClients` are genuinely windowed by `rangeDays`
 * (current vs the equal-length period before it). `pipelineTotal` and
 * `forecast` stay current-state snapshots regardless of range — "how
 * much is in the pipeline right now" has no meaningful reading for
 * "the pipeline as of N days ago" without deal-history snapshotting,
 * which this app doesn't keep. `totalClients` is likewise an all-time
 * cumulative count.
 *
 * `goalThisMonth` (and `goalAttainmentPct`, which divides by it) IS
 * prorated to the selected range — it's what "sales in this period"
 * gets compared against, so it has to scale with it. `pipelineCoverage`
 * and `forecastPct`, on the other hand, are deliberately measured
 * against the UNSCALED monthly goal (`monthlyGoal`, not
 * `goalForRange`) — "pipeline coverage" and "forecast vs goal" are
 * conventional monthly sales-ops ratios (the 3x threshold elsewhere in
 * this file was calibrated for that cadence); dividing a snapshot by a
 * one-day sliver of the goal would produce a meaningless multiple.
 */
export async function loadCeoMetrics(db: DB, rangeDays: number): Promise<CeoMetrics> {
  const now = new Date()
  const thisMonthKey = monthKey(now)
  const currentStart = rangeStart(rangeDays).toISOString()
  const previousStart = previousRangeStart(rangeDays).toISOString()

  type OpenDealRow = {
    value: number | null
    stage:
      | { win_probability: number | null }[]
      | { win_probability: number | null }
      | null
  }
  type ContactRow = { contact_id: string | null }

  const [
    wonCurrent,
    wonPrevious,
    goalRow,
    openDeals,
    contactsAll,
    contactsCurrent,
    contactsPrevious,
  ] = await Promise.all([
    db.from('deals').select('value').eq('status', 'won').gte('closed_at', currentStart),
    db
      .from('deals')
      .select('value')
      .eq('status', 'won')
      .gte('closed_at', previousStart)
      .lt('closed_at', currentStart),
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
      .gte('created_at', currentStart),
    db
      .from('deals')
      .select('contact_id')
      .not('contact_id', 'is', null)
      .gte('created_at', previousStart)
      .lt('created_at', currentStart),
  ])

  for (const r of [wonCurrent, wonPrevious, goalRow, openDeals, contactsAll, contactsCurrent, contactsPrevious]) {
    if (r.error) throw r.error
  }

  const sum = (rows: { value: number | null }[]) =>
    rows.reduce((s, r) => s + (r.value ?? 0), 0)
  const salesCurrentValue = sum((wonCurrent.data ?? []) as { value: number | null }[])
  const salesPreviousValue = sum((wonPrevious.data ?? []) as { value: number | null }[])

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
  const newClientsCurrent = distinctContacts((contactsCurrent.data ?? []) as ContactRow[])
  const newClientsPrevious = distinctContacts((contactsPrevious.data ?? []) as ContactRow[])

  const monthlyGoal = (goalRow.data as { target_value: number } | null)?.target_value ?? null
  const goalForRange = monthlyGoal != null ? (monthlyGoal / daysInMonthOf(now)) * rangeDays : null

  return {
    salesThisMonth: { current: salesCurrentValue, previous: salesPreviousValue },
    goalThisMonth: goalForRange,
    goalAttainmentPct: goalForRange ? (salesCurrentValue / goalForRange) * 100 : null,
    pipelineTotal,
    pipelineCoverage: monthlyGoal ? pipelineTotal / monthlyGoal : null,
    forecast,
    forecastPct: monthlyGoal ? (forecast / monthlyGoal) * 100 : null,
    newClients: { current: newClientsCurrent, previous: newClientsPrevious },
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

/**
 * `goal` is each member's individual monthly goal prorated to
 * `rangeDays`, same linear-run-rate approach (and same caveat for
 * ranges beyond the current month) as the account-level goal in
 * `loadCeoMetrics`.
 */
export async function loadTopSellers(db: DB, rangeDays: number, limit = 5): Promise<TopSeller[]> {
  const now = new Date()
  const thisMonthKey = monthKey(now)
  const currentStart = rangeStart(rangeDays).toISOString()
  const daysInMonth = daysInMonthOf(now)

  const [membersRes, dealsRes, goalsRes] = await Promise.all([
    // profiles.id (NOT user_id) is what deals.assigned_to and
    // sales_goals.user_id actually reference (see migrations 002 and
    // 053) — every leaderboard row used to key off profiles.user_id
    // instead, so soldByUser/goalByUser below never matched any
    // member and this leaderboard silently rendered empty.
    db.from('profiles').select('id, full_name, email'),
    db
      .from('deals')
      .select('assigned_to, value')
      .eq('status', 'won')
      .gte('closed_at', currentStart)
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

  const soldByMember = new Map<string, number>()
  for (const d of (dealsRes.data ?? []) as { assigned_to: string; value: number | null }[]) {
    soldByMember.set(d.assigned_to, (soldByMember.get(d.assigned_to) ?? 0) + (d.value ?? 0))
  }
  const goalByMember = new Map<string, number>()
  for (const g of (goalsRes.data ?? []) as { user_id: string; target_value: number }[]) {
    goalByMember.set(g.user_id, (g.target_value / daysInMonth) * rangeDays)
  }

  const members = (membersRes.data ?? []) as { id: string; full_name: string | null; email: string | null }[]

  return members
    // Only members who actually sold something in range, or have a
    // quota set — otherwise every viewer/admin with zero deals would
    // clutter what's meant to be a sales leaderboard.
    .filter((m) => soldByMember.has(m.id) || goalByMember.has(m.id))
    .map((m) => {
      const soldThisMonth = soldByMember.get(m.id) ?? 0
      const goal = goalByMember.get(m.id) ?? null
      return {
        userId: m.id,
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

export async function loadCeoAlerts(
  db: DB,
  metrics: CeoMetrics,
  staleDays = 7,
  trendWindowDays = 90,
): Promise<CeoAlerts> {
  const forecastGapPct = computeForecastGap(metrics.forecast, metrics.goalThisMonth)
  const lowPipelineCoverage =
    metrics.pipelineCoverage != null && metrics.pipelineCoverage < HEALTHY_PIPELINE_COVERAGE
      ? metrics.pipelineCoverage
      : null

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
