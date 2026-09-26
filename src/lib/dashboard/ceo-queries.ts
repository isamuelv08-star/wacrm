import type { SupabaseClient } from '@supabase/supabase-js'
import {
  monthKey,
  daysAgoStart,
  daysInMonthOf,
  previousRange,
  rangeBuckets,
  type DateRange,
} from './date-utils'
import type {
  CeoAlerts,
  CeoMetrics,
  CommercialMetrics,
  FunnelStep,
  LeadsByRep,
  SalesFunnelData,
  SalesVsGoalPoint,
  TopSeller,
} from './ceo-types'

// ------------------------------------------------------------
// Aggregation happens IN THE DATABASE (migration 118, ceo_* functions):
// these used to download every deal a KPI needed and sum it in Node,
// which grew with the account's whole sales history. The functions are
// SECURITY INVOKER — RLS still scopes them — and take an optional
// account id: omitted, they use the caller's own account; the
// service-role risk-engine cron passes it explicitly.
// ------------------------------------------------------------

type DB = SupabaseClient

/** "No upper bound" for the closed-deal windows. */
const FAR_FUTURE = '9999-12-31T00:00:00.000Z'

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

interface ClosedHalf {
  won: number
  lost: number
  wonValue: number
  lostValue: number
  /** Average days from creation to close of the won deals; null when none. */
  avgCycleDays: number | null
}
const EMPTY_HALF: ClosedHalf = { won: 0, lost: 0, wonValue: 0, lostValue: 0, avgCycleDays: null }

/** Won/lost deals closed in [from, to), split at `split` into previous / current. */
async function closedStats(
  db: DB,
  accountId: string | undefined,
  from: string,
  split: string,
  to: string,
): Promise<{ current: ClosedHalf; previous: ClosedHalf }> {
  const { data, error } = await db.rpc('ceo_closed_stats', {
    p_account_id: accountId ?? null,
    p_from: from,
    p_split: split,
    p_to: to,
  })
  if (error) throw error
  const out = { current: { ...EMPTY_HALF }, previous: { ...EMPTY_HALF } }
  for (const r of (data ?? []) as {
    half: 'current' | 'previous'
    won_count: unknown
    lost_count: unknown
    won_value: unknown
    lost_value: unknown
    avg_cycle_days: unknown
  }[]) {
    out[r.half] = {
      won: num(r.won_count),
      lost: num(r.lost_count),
      wonValue: num(r.won_value),
      lostValue: num(r.lost_value),
      avgCycleDays: r.avg_cycle_days == null ? null : num(r.avg_cycle_days),
    }
  }
  return out
}

const winRateOfHalf = (h: ClosedHalf) => (h.won + h.lost > 0 ? (h.won / (h.won + h.lost)) * 100 : null)
const avgTicketOfHalf = (h: ClosedHalf) => (h.won > 0 ? h.wonValue / h.won : 0)

interface Snapshot {
  pipeline_total: number
  forecast: number
  total_clients: number
  new_clients_current: number
  new_clients_previous: number
  created_current: number
  created_previous: number
}

/** Open pipeline / forecast now, plus deal & client counts for two windows. */
async function snapshot(
  db: DB,
  accountId: string | undefined,
  previousStart: string,
  currentStart: string,
  currentEnd: string,
): Promise<Snapshot> {
  const { data, error } = await db.rpc('ceo_snapshot', {
    p_account_id: accountId ?? null,
    p_prev_start: previousStart,
    p_cur_start: currentStart,
    p_cur_end: currentEnd,
  })
  if (error) throw error
  const r = (data ?? {}) as Record<string, unknown>
  return {
    pipeline_total: num(r.pipeline_total),
    forecast: num(r.forecast),
    total_clients: num(r.total_clients),
    new_clients_current: num(r.new_clients_current),
    new_clients_previous: num(r.new_clients_previous),
    created_current: num(r.created_current),
    created_previous: num(r.created_previous),
  }
}

interface SellerStatsRow {
  assigned_to: string
  won_current: unknown
  lost_current: unknown
  won_previous: unknown
  lost_previous: unknown
  value_won_current: unknown
  value_won_previous: unknown
}

async function sellerClosedStats(db: DB, from: string, split: string, to: string): Promise<SellerStatsRow[]> {
  const { data, error } = await db.rpc('ceo_seller_closed_stats', {
    p_account_id: null,
    p_from: from,
    p_split: split,
    p_to: to,
  })
  if (error) throw error
  return (data ?? []) as SellerStatsRow[]
}

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
 * Buckets the selected period (daily for ≤30 days, ~30 multi-day
 * buckets for a quarter / year / all-time — see `rangeBuckets`) and
 * returns two RUNNING TOTALS: cumulative actual won-deal revenue, and
 * a cumulative target trajectory toward the account's monthly goal.
 *
 * Cumulative rather than per-bucket — this used to divide the monthly
 * goal into a flat per-day slice and plot THAT as "the goal" for every
 * bucket, so the chart showed a number like "$4,839" that matched
 * nothing the account actually configured (the real, single number
 * they typed into Settings is the full monthly goal, e.g. $150,000).
 * The cumulative framing puts that exact configured number back on the
 * chart: the goal line is 0 at the period's start and reaches the full
 * (range-scaled) target by its end, so the reader can see actual
 * revenue-to-date against where it needs to be — the standard "pacing
 * toward a target" chart, and one where hovering the last point on a
 * full-month view shows precisely the number from Settings.
 *
 * There's only ever one goal on the books (this month's), so a range
 * longer than one month necessarily assumes "if every month kept pace
 * with this one" (the target trajectory is a straight line from 0 to
 * monthlyGoal × however many months the range spans) rather than
 * replaying whatever the goal actually was in each past month —
 * simpler and still a meaningful trend line, but worth knowing it's a
 * projection for anything beyond the current month.
 */
export async function loadSalesVsGoal(db: DB, range: DateRange): Promise<SalesVsGoalPoint[]> {
  const buckets = rangeBuckets(range)
  if (buckets.length === 0) return []
  // Contiguous buckets → n + 1 edges; the database sums won revenue per bucket.
  const edges = [buckets[0].start, ...buckets.map((b) => b.end)].map((d) => d.toISOString())

  const [bucketRes, goalRow] = await Promise.all([
    db.rpc('ceo_won_by_bucket', { p_account_id: null, p_edges: edges }),
    db
      .from('sales_goals')
      .select('target_value')
      .is('user_id', null)
      .eq('period_month', monthKey(new Date()))
      .maybeSingle(),
  ])
  if (bucketRes.error) throw bucketRes.error
  if (goalRow.error) throw goalRow.error

  const byBucket = new Map<number, number>()
  for (const r of (bucketRes.data ?? []) as { bucket: number; total: unknown }[]) {
    byBucket.set(Number(r.bucket), num(r.total))
  }
  const monthlyGoal = (goalRow.data as { target_value: number } | null)?.target_value ?? null
  const goalPerDay = monthlyGoal != null ? monthlyGoal / daysInMonthOf(new Date()) : null

  let cumulativeActual = 0
  let cumulativeGoal = 0
  return buckets.map((b, i) => {
    cumulativeActual += byBucket.get(i + 1) ?? 0

    const bucketDays = Math.max(1, Math.round((b.end.getTime() - b.start.getTime()) / 86_400_000))
    if (goalPerDay != null) cumulativeGoal += goalPerDay * bucketDays

    return {
      label: b.label,
      actual: cumulativeActual,
      goal: goalPerDay != null ? cumulativeGoal : null,
    }
  })
}

// --- 2. Headline KPIs -----------------------------------------------------

/**
 * `salesThisMonth`/`newClients` are genuinely windowed by `range`
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
 *
 * `accountId` is optional and every existing call site omits it —
 * without it, every query below is scoped by RLS exactly as before
 * (the caller's own account, via `is_account_member`). It exists for
 * the sales-intelligence risk-engine cron (src/lib/sales-intelligence/
 * risk-engine.ts), which runs under the service role — a role RLS
 * doesn't scope at all — and must loop over every account explicitly,
 * one at a time, passing that account's id here.
 */
export async function loadCeoMetrics(db: DB, range: DateRange, accountId?: string): Promise<CeoMetrics> {
  const now = new Date()
  const thisMonthKey = monthKey(now)
  const currentStart = range.start.toISOString()
  const currentEnd = range.end.toISOString()
  const previousStart = previousRange(range).start.toISOString()

  let goalRowQ = db.from('sales_goals').select('target_value').is('user_id', null).eq('period_month', thisMonthKey)
  if (accountId) goalRowQ = goalRowQ.eq('account_id', accountId)

  // Won revenue by close date (previous vs current window) and the
  // open-pipeline / client counts, both summed in the database.
  const [closed, snap, goalRow] = await Promise.all([
    closedStats(db, accountId, previousStart, currentStart, currentEnd),
    snapshot(db, accountId, previousStart, currentStart, currentEnd),
    goalRowQ.maybeSingle(),
  ])
  if (goalRow.error) throw goalRow.error

  const salesCurrentValue = closed.current.wonValue
  const salesPreviousValue = closed.previous.wonValue
  const pipelineTotal = snap.pipeline_total
  const forecast = snap.forecast

  const monthlyGoal = (goalRow.data as { target_value: number } | null)?.target_value ?? null
  const rangeDays = Math.max(1, Math.round((range.end.getTime() - range.start.getTime()) / 86_400_000))
  const goalForRange = monthlyGoal != null ? (monthlyGoal / daysInMonthOf(now)) * rangeDays : null

  return {
    salesThisMonth: { current: salesCurrentValue, previous: salesPreviousValue },
    goalThisMonth: goalForRange,
    monthlyGoal,
    goalAttainmentPct: goalForRange ? (salesCurrentValue / goalForRange) * 100 : null,
    pipelineTotal,
    pipelineCoverage: monthlyGoal ? pipelineTotal / monthlyGoal : null,
    forecast,
    forecastPct: monthlyGoal ? (forecast / monthlyGoal) * 100 : null,
    newClients: { current: snap.new_clients_current, previous: snap.new_clients_previous },
    totalClients: snap.total_clients,
  }
}

// --- 3. Commercial metrics (win rate, avg ticket, sales cycle) -----------

export async function loadCommercialMetrics(db: DB, windowDays = 90): Promise<CommercialMetrics> {
  const start = daysAgoStart(windowDays).toISOString()
  const { current } = await closedStats(db, undefined, start, start, FAR_FUTURE)
  return {
    winRatePct: winRateOfHalf(current),
    avgTicket: avgTicketOfHalf(current),
    avgSalesCycleDays: current.avgCycleDays,
  }
}

export interface PeriodCommercialTrend {
  /** Percent, 0-100. Null when the window has no closed deal to score. */
  winRatePct: { current: number | null; previous: number | null }
  /** Average VALUE of won deals — 0, not null, when there's nothing won yet. */
  avgTicket: { current: number; previous: number }
  /** Deals CREATED in the window (any status, open or already closed) —
   *  "how many opportunities came in", independent of what happened to
   *  them since. Distinct from `newClients` (loadCeoMetrics), which
   *  counts distinct CONTACTS, not deals — one contact can have
   *  several deals. */
  opportunitiesCreated: { current: number; previous: number }
}

/**
 * The same win-rate/avg-ticket math `loadCommercialMetrics` already
 * does, and the same current-vs-immediately-preceding-equal-period
 * comparison `loadCeoMetrics` already does for revenue/leads — this is
 * the missing third piece: those two functions don't share a common
 * "arbitrary selected range vs its own prior period" contract
 * (`loadCommercialMetrics` only ever looks at a fixed trailing window
 * from today; `loadCeoAlerts`'s win-rate-decline check is the same
 * fixed-window shape). Centro de Decisiones needs win rate/avg ticket
 * tied to whatever period the manager picked (today, 7 days, custom…),
 * so this reuses `previousRange` (date-utils.ts) — the exact helper
 * `loadCeoMetrics` already uses for revenue/leads — instead of
 * inventing a second definition of "the period before this one".
 */
export async function loadPeriodCommercialTrend(
  db: DB,
  range: DateRange,
  accountId?: string,
): Promise<PeriodCommercialTrend> {
  const currentStart = range.start.toISOString()
  const currentEnd = range.end.toISOString()
  const previousStart = previousRange(range).start.toISOString()

  const [closed, snap] = await Promise.all([
    closedStats(db, accountId, previousStart, currentStart, currentEnd),
    snapshot(db, accountId, previousStart, currentStart, currentEnd),
  ])

  return {
    winRatePct: { current: winRateOfHalf(closed.current), previous: winRateOfHalf(closed.previous) },
    avgTicket: { current: avgTicketOfHalf(closed.current), previous: avgTicketOfHalf(closed.previous) },
    opportunitiesCreated: { current: snap.created_current, previous: snap.created_previous },
  }
}

export interface SellerPeriodPerformance {
  userId: string
  name: string
  dealsWonCurrent: number
  dealsWonPrevious: number
  dealsLostCurrent: number
  dealsLostPrevious: number
  /** Percent, 0-100. Null when the member had no closed deal in that
   *  half of the window — no rate to report, not a rate of 0. */
  winRateCurrent: number | null
  winRatePrevious: number | null
  valueWonCurrent: number
  valueWonPrevious: number
  /** valueWon / dealsWon for that half of the window — 0, not null,
   *  when nothing closed won yet (same convention avgTicket already
   *  uses elsewhere in this file). */
  avgTicketCurrent: number
  avgTicketPrevious: number
}

/**
 * Per-seller current-vs-previous-period win rate — the "who is the
 * business falling behind on" input for Centro de Decisiones' "Dónde
 * está cayendo el negocio" breakdown. Same closed-deals-in-window
 * query `loadPeriodCommercialTrend` already runs for the account-wide
 * number, just grouped by `assigned_to` instead of aggregated —
 * deliberately kept as a separate function (not a parameter on that
 * one) since the two are read independently: the KPI card wants one
 * account-wide number, this wants one row per member.
 *
 * Returns EVERY member of the account, not just the ones who closed
 * something in the window — unlike `loadTopSellers` (a leaderboard,
 * where a zero-activity row is just clutter), this feeds a manager's
 * team-accountability table, where "this rep closed nothing this
 * period" is itself the decision-worthy signal. A member with no
 * closed deals in a given half of the window gets `winRateCurrent`/
 * `winRatePrevious: null` (see the field doc) rather than being
 * silently dropped — confirmed as a real bug via production data: an
 * account with 3 reps only ever showed 2, because the third had open
 * deals assigned but nothing closed in the last 30 days.
 */
export async function loadSellerPeriodPerformance(
  db: DB,
  range: DateRange,
): Promise<SellerPeriodPerformance[]> {
  const currentStart = range.start.toISOString()
  const currentEnd = range.end.toISOString()
  const previousStart = previousRange(range).start.toISOString()

  const [membersRes, stats] = await Promise.all([
    db.from('profiles').select('id, full_name, email'),
    sellerClosedStats(db, previousStart, currentStart, currentEnd),
  ])
  if (membersRes.error) throw membersRes.error

  const byMember = new Map(stats.map((r) => [r.assigned_to, r]))
  const members = (membersRes.data ?? []) as { id: string; full_name: string | null; email: string | null }[]
  const rate = (won: number, lost: number) => (won + lost > 0 ? (won / (won + lost)) * 100 : null)

  return members.map((m) => {
    const r = byMember.get(m.id)
    const wonC = num(r?.won_current)
    const lostC = num(r?.lost_current)
    const wonP = num(r?.won_previous)
    const lostP = num(r?.lost_previous)
    const valC = num(r?.value_won_current)
    const valP = num(r?.value_won_previous)
    return {
      userId: m.id,
      name: m.full_name || m.email || '—',
      dealsWonCurrent: wonC,
      dealsWonPrevious: wonP,
      dealsLostCurrent: lostC,
      dealsLostPrevious: lostP,
      winRateCurrent: rate(wonC, lostC),
      winRatePrevious: rate(wonP, lostP),
      valueWonCurrent: valC,
      valueWonPrevious: valP,
      avgTicketCurrent: wonC > 0 ? valC / wonC : 0,
      avgTicketPrevious: wonP > 0 ? valP / wonP : 0,
    }
  })
}

// --- 4. Top sellers vs their individual goal ------------------------------

/**
 * `goal` is each member's individual monthly goal prorated to the
 * selected range's day count, same linear-run-rate approach (and same
 * caveat for ranges beyond the current month) as the account-level
 * goal in `loadCeoMetrics`.
 */
export async function loadTopSellers(db: DB, range: DateRange, limit = 5): Promise<TopSeller[]> {
  const now = new Date()
  const thisMonthKey = monthKey(now)
  const currentStart = range.start.toISOString()
  const currentEnd = range.end.toISOString()
  const daysInMonth = daysInMonthOf(now)
  const rangeDays = Math.max(1, Math.round((range.end.getTime() - range.start.getTime()) / 86_400_000))

  const [membersRes, stats, goalsRes] = await Promise.all([
    // profiles.id (NOT user_id) is what deals.assigned_to and
    // sales_goals.user_id actually reference (see migrations 002 and
    // 053).
    db.from('profiles').select('id, full_name, email'),
    sellerClosedStats(db, currentStart, currentStart, currentEnd),
    db
      .from('sales_goals')
      .select('user_id, target_value')
      .eq('period_month', thisMonthKey)
      .not('user_id', 'is', null),
  ])
  if (membersRes.error) throw membersRes.error
  if (goalsRes.error) throw goalsRes.error

  const soldByMember = new Map<string, number>()
  for (const r of stats) {
    if (num(r.won_current) > 0) soldByMember.set(r.assigned_to, num(r.value_won_current))
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

// --- 4b. Leads currently owned by each rep ---------------------------------

/**
 * Current snapshot (not date-ranged, unlike `loadTopSellers` — this is
 * "who owns what right now", not a period metric) of how leads are
 * spread across the team: open conversations someone is actively
 * handling (`conversations.assigned_agent_id`) plus open deals someone
 * owns (`deals.assigned_to`) — kept as two separate counts rather than
 * merged into one, since a lead the AI's equitable distribution
 * (migration 069) routed overnight can be a deal owner before it's
 * ever picked up as a conversation (see lead-scoring.ts). Only
 * surfaces members with at least one of either, same "don't clutter
 * with zero rows" posture as `loadTopSellers`.
 */
export async function loadLeadsByRep(db: DB): Promise<LeadsByRep[]> {
  const [membersRes, countsRes] = await Promise.all([
    db.from('profiles').select('id, user_id, full_name, email'),
    db.rpc('ceo_leads_by_rep', { p_account_id: null }),
  ])
  if (membersRes.error) throw membersRes.error
  if (countsRes.error) throw countsRes.error

  // Conversations are keyed by the agent's auth user id, deals by profile id.
  const convCountByUser = new Map<string, number>()
  const dealCountByProfile = new Map<string, number>()
  for (const r of (countsRes.data ?? []) as { kind: string; member_id: string; n: unknown }[]) {
    if (r.kind === 'conversation') convCountByUser.set(r.member_id, num(r.n))
    else dealCountByProfile.set(r.member_id, num(r.n))
  }

  const members = (membersRes.data ?? []) as {
    id: string
    user_id: string
    full_name: string | null
    email: string | null
  }[]

  return members
    .map((m) => ({
      userId: m.user_id,
      name: m.full_name || m.email || '—',
      assignedConversations: convCountByUser.get(m.user_id) ?? 0,
      assignedDeals: dealCountByProfile.get(m.id) ?? 0,
    }))
    .filter((r) => r.assignedConversations > 0 || r.assignedDeals > 0)
    .sort(
      (a, b) =>
        b.assignedConversations + b.assignedDeals - (a.assignedConversations + a.assignedDeals),
    )
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
  // Optional, same reasoning as loadCeoMetrics's own `accountId` param
  // above — every existing call site omits it and keeps relying on
  // RLS; the risk-engine cron passes it explicitly per account since
  // it runs under the service role.
  accountId?: string,
): Promise<CeoAlerts> {
  // `monthlyGoal`, not `goalThisMonth` — the forecast is a whole-pipeline
  // snapshot with no date range of its own, so comparing it against a
  // goal prorated to the selected window made the same pipeline read as
  // "42% short" on a 7-day range and "on track" on a 1-day one. This is
  // the ratio `forecastPct` already reports on the Forecast card itself,
  // so the alert now agrees with the number it's alerting about.
  const forecastGapPct = computeForecastGap(metrics.forecast, metrics.monthlyGoal)
  const lowPipelineCoverage =
    metrics.pipelineCoverage != null && metrics.pipelineCoverage < HEALTHY_PIPELINE_COVERAGE
      ? metrics.pipelineCoverage
      : null

  const currentWindowStart = daysAgoStart(trendWindowDays).toISOString()
  const priorWindowStart = daysAgoStart(trendWindowDays * 2).toISOString()

  const [stalledDeals, trend, atRiskDeals] = await Promise.all([
    findStalledOpenDeals(db, staleDays, accountId),
    // Win rate / sales cycle: current window vs. the one before it.
    closedStats(db, accountId, priorWindowStart, currentWindowStart, FAR_FUTURE),
    findAtRiskOpenDeals(db, AT_RISK_CONVERSATION_SILENCE_DAYS, accountId),
  ])

  const stalledCount = stalledDeals.length
  const stalledValue = stalledDeals.reduce((s, d) => s + (d.value ?? 0), 0)

  const cur = trend.current
  const prior = trend.previous

  let winRateDeclinePts: number | null = null
  if (cur.won + cur.lost >= MIN_SAMPLES_FOR_TREND && prior.won + prior.lost >= MIN_SAMPLES_FOR_TREND) {
    const curRate = winRateOfHalf(cur)
    const priorRate = winRateOfHalf(prior)
    // Only a real decline (not noise, not an improvement) counts as an alert.
    if (curRate != null && priorRate != null && priorRate - curRate >= 3) winRateDeclinePts = priorRate - curRate
  }

  let salesCycleIncreasePct: number | null = null
  if (cur.won >= MIN_SAMPLES_FOR_TREND && prior.won >= MIN_SAMPLES_FOR_TREND) {
    const curCycle = cur.avgCycleDays
    const priorCycle = prior.avgCycleDays
    if (curCycle != null && priorCycle != null && priorCycle > 0 && curCycle > priorCycle * 1.1) {
      salesCycleIncreasePct = ((curCycle - priorCycle) / priorCycle) * 100
    }
  }

  const atRiskCustomerCount = atRiskDeals.length

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

export interface StalledOpenDeal {
  id: string
  value: number | null
  stageId: string | null
  assignedTo: string | null
  contactId: string | null
  conversationId: string | null
  /** When this deal's current stage placement was recorded — lets a
   *  caller (e.g. Next Best Action) compute exactly how many days
   *  it's been stalled, not just "yes/no past the threshold". */
  lastStageChangeAt: string
}

/**
 * Open deals whose most recent stage placement (per
 * `deal_stage_history`) is older than `staleDays` — "what counts as
 * stalled", extracted into its own function so it has exactly one
 * definition in the codebase. `loadCeoAlerts` below only needs the
 * count and summed value; `loadMoneyAtRiskBreakdown`
 * (src/lib/sales-intelligence/queries.ts) needs the per-deal
 * stage/owner to group by, and `loadNextBestActions`
 * (src/lib/sales-intelligence/next-best-action.ts) needs the
 * contact/conversation too, to turn each one into an actionable row —
 * all three call this rather than each re-deriving "stalled" on
 * their own.
 */
export async function findStalledOpenDeals(
  db: DB,
  staleDays: number,
  accountId?: string,
): Promise<StalledOpenDeal[]> {
  let openDealsQ = db
    .from('deals')
    .select('id, value, stage_id, assigned_to, contact_id, conversation_id')
    .eq('status', 'open')
    .limit(MAX_OPEN_DEALS_SCANNED)
  if (accountId) openDealsQ = openDealsQ.eq('account_id', accountId)
  const { data, error } = await openDealsQ
  if (error) throw error

  const openDeals = (data ?? []) as {
    id: string
    value: number | null
    stage_id: string | null
    assigned_to: string | null
    contact_id: string | null
    conversation_id: string | null
  }[]
  if (openDeals.length === 0) return []

  let historyQ = db
    .from('deal_stage_history')
    .select('deal_id, changed_at')
    .in(
      'deal_id',
      openDeals.map((d) => d.id),
    )
    .order('changed_at', { ascending: false })
  // Redundant with the deal-id list already being account-scoped
  // above, but cheap defense-in-depth, same reasoning as elsewhere in
  // this file.
  if (accountId) historyQ = historyQ.eq('account_id', accountId)
  const { data: history, error: histErr } = await historyQ
  if (histErr) throw histErr

  // First row per deal_id wins — history is ordered newest first, so
  // that's each deal's most recent stage placement.
  const lastChangeByDeal = new Map<string, string>()
  for (const h of (history ?? []) as { deal_id: string; changed_at: string }[]) {
    if (!lastChangeByDeal.has(h.deal_id)) lastChangeByDeal.set(h.deal_id, h.changed_at)
  }

  const staleCutoff = Date.now() - staleDays * 86_400_000
  const stalled: StalledOpenDeal[] = []
  for (const d of openDeals) {
    const lastChange = lastChangeByDeal.get(d.id)
    // No history row shouldn't happen (the insert trigger always
    // writes one) — skip rather than guess if it's ever missing.
    if (!lastChange) continue
    if (new Date(lastChange).getTime() < staleCutoff) {
      stalled.push({
        id: d.id,
        value: d.value,
        stageId: d.stage_id,
        assignedTo: d.assigned_to,
        contactId: d.contact_id,
        conversationId: d.conversation_id,
        lastStageChangeAt: lastChange,
      })
    }
  }
  return stalled
}

export interface AtRiskOpenDeal {
  id: string
  value: number | null
  stageId: string | null
  assignedTo: string | null
  contactId: string | null
  conversationId: string | null
  /** Null only if the conversation genuinely has no messages yet. */
  lastMessageAt: string | null
}

/**
 * Open deals whose linked conversation has gone quiet (no message,
 * either direction) for at least `silenceDays` — "what counts as
 * at-risk", extracted the same way `findStalledOpenDeals` was: shared
 * by `loadCeoAlerts` (count only) and `loadNextBestActions`
 * (src/lib/sales-intelligence/next-best-action.ts, which needs the
 * per-deal contact/conversation to build a "re-engage this customer"
 * action).
 */
export async function findAtRiskOpenDeals(
  db: DB,
  silenceDays: number,
  accountId?: string,
): Promise<AtRiskOpenDeal[]> {
  let riskQ = db
    .from('deals')
    .select('id, value, stage_id, assigned_to, contact_id, conversation_id, conversation:conversations(last_message_at)')
    .eq('status', 'open')
    .not('conversation_id', 'is', null)
    .limit(MAX_OPEN_DEALS_SCANNED)
  if (accountId) riskQ = riskQ.eq('account_id', accountId)
  const { data, error } = await riskQ
  if (error) throw error

  type Row = {
    id: string
    value: number | null
    stage_id: string | null
    assigned_to: string | null
    contact_id: string | null
    conversation_id: string | null
    conversation: { last_message_at: string | null }[] | { last_message_at: string | null } | null
  }
  const cutoff = Date.now() - silenceDays * 86_400_000
  const atRisk: AtRiskOpenDeal[] = []
  for (const d of (data ?? []) as unknown as Row[]) {
    const conv = Array.isArray(d.conversation) ? d.conversation[0] : d.conversation
    const lastMessageAt = conv?.last_message_at ?? null
    if (!lastMessageAt || new Date(lastMessageAt).getTime() < cutoff) {
      atRisk.push({
        id: d.id,
        value: d.value,
        stageId: d.stage_id,
        assignedTo: d.assigned_to,
        contactId: d.contact_id,
        conversationId: d.conversation_id,
        lastMessageAt,
      })
    }
  }
  return atRisk
}

export interface HotLeadsUnansweredResult {
  count: number
  contactIds: string[]
  conversationIds: string[]
  /** The account's own configured threshold (`hot_lead_alert_minutes`),
   *  echoed back so a caller can phrase "sin responder hace más de N
   *  minutos" without a second query. */
  thresholdMinutes: number
}

/**
 * How many open, HOT-scored conversations have gone unanswered past
 * the account's own alert threshold — the aggregate count behind
 * "17 oportunidades HOT sin seguimiento". Reuses the exact same
 * candidate query `runHotLeadAlertScan` (src/lib/notifications/
 * hot-lead-alerts.ts) and `loadHotUnanswered` (./queries.ts) already
 * run (open conversation + `contacts.lead_score='hot'` + last message
 * from the customer) — this function only adds counting instead of
 * writing a notification, and gates on `hot_lead_alert_minutes` the
 * same way the alert scan does, so "0" here means the same thing as
 * "nothing to alert on" there. An account with alerting disabled
 * (`hot_lead_alert_minutes` 0/null) returns a 0 count rather than
 * flagging every HOT lead as urgent regardless of age.
 */
export async function countHotLeadsUnanswered(
  db: DB,
  accountId?: string,
): Promise<HotLeadsUnansweredResult> {
  const none: HotLeadsUnansweredResult = {
    count: 0,
    contactIds: [],
    conversationIds: [],
    thresholdMinutes: 0,
  }

  // The threshold lives on `accounts` — for the RLS-scoped (no
  // accountId) call this reads the caller's own single row; for the
  // cron's service-role call it's the one account being scanned.
  let acctQ = db.from('accounts').select('id, hot_lead_alert_minutes')
  acctQ = accountId ? acctQ.eq('id', accountId) : acctQ.limit(1)
  const { data: acctRow, error: acctErr } = await acctQ.maybeSingle()
  if (acctErr) throw acctErr
  const thresholdMinutes = acctRow?.hot_lead_alert_minutes ?? 0
  if (!thresholdMinutes || thresholdMinutes <= 0) return none // alerting disabled for this account

  // Waiting on us past the threshold: the conversation row already
  // carries who wrote last and when (migration 050's trigger) — this
  // used to fetch the last message of up to 500 conversations one by one.
  const cutoffIso = new Date(Date.now() - thresholdMinutes * 60_000).toISOString()
  let candidatesQ = db
    .from('conversations')
    .select('id, contact_id, contacts!inner(lead_score)')
    .eq('status', 'open')
    .eq('contacts.lead_score', 'hot')
    .eq('last_message_sender_type', 'customer')
    .lte('last_message_at', cutoffIso)
    .limit(MAX_OPEN_DEALS_SCANNED)
  if (accountId) candidatesQ = candidatesQ.eq('account_id', accountId)
  const { data: candidates, error } = await candidatesQ
  if (error) throw error
  if (!candidates || candidates.length === 0) return none

  const unanswered = candidates as unknown as { id: string; contact_id: string }[]
  return {
    count: unanswered.length,
    contactIds: unanswered.map((c) => c.contact_id),
    conversationIds: unanswered.map((c) => c.id),
    thresholdMinutes,
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
 *
 * Stages flagged `is_won_stage`/`is_lost_stage` (migration 060) are
 * excluded from `steps` — they're where a deal branches OUT of the
 * pipeline, not a stage every deal advances through, so counting them
 * as a funnel bar rendered a confusing Won/Lost bar sitting right next
 * to the synthetic `won` bookend below. Their outcome is summarized
 * instead in the returned `wonCount`/`lostCount`/conversion fields —
 * the numbers the dashboard's conversion card (just beneath the chart)
 * reads from.
 */
export async function loadSalesFunnel(db: DB, days = 90): Promise<SalesFunnelData> {
  const windowStart = daysAgoStart(days).toISOString()

  const [stagesRes, leadsRes, reachedRes, closed] = await Promise.all([
    db.from('pipeline_stages').select('id, name, is_won_stage, is_lost_stage').order('position'),
    db.from('contacts').select('id', { count: 'exact', head: true }).gte('created_at', windowStart),
    // Distinct deals that reached each stage in the window + their value.
    db.rpc('ceo_funnel_stages', { p_account_id: null, p_since: windowStart }),
    closedStats(db, undefined, windowStart, windowStart, FAR_FUTURE),
  ])
  if (stagesRes.error) throw stagesRes.error
  if (leadsRes.error) throw leadsRes.error
  if (reachedRes.error) throw reachedRes.error

  const reachedByStage = new Map<string, { count: number; value: number }>()
  for (const r of (reachedRes.data ?? []) as { stage_id: string; deal_count: unknown; deal_value: unknown }[]) {
    reachedByStage.set(r.stage_id, { count: num(r.deal_count), value: num(r.deal_value) })
  }

  const stages = (stagesRes.data ?? []) as {
    id: string
    name: string
    is_won_stage: boolean | null
    is_lost_stage: boolean | null
  }[]
  const funnelStages = stages.filter((s) => !s.is_won_stage && !s.is_lost_stage)
  const stageSteps: FunnelStep[] = funnelStages.map((s) => {
    const reached = reachedByStage.get(s.id)
    return { key: s.id, label: s.name, count: reached?.count ?? 0, value: reached?.value ?? 0 }
  })

  const leadsCount = leadsRes.count ?? 0
  const wonCount = closed.current.won
  const lostCount = closed.current.lost
  const wonValue = closed.current.wonValue
  const lostValue = closed.current.lostValue

  const leadsStep: FunnelStep = { key: 'leads', label: '', count: leadsCount, value: null }
  const wonStep: FunnelStep = { key: 'won', label: '', count: wonCount, value: wonValue }

  return {
    steps: [leadsStep, ...stageSteps, wonStep],
    wonCount,
    wonValue,
    lostCount,
    lostValue,
    leadToWonPct: leadsCount > 0 ? (wonCount / leadsCount) * 100 : null,
    winRatePct: wonCount + lostCount > 0 ? (wonCount / (wonCount + lostCount)) * 100 : null,
  }
}
