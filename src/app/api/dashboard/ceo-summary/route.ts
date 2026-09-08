import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { loadDashboardAccess } from '@/lib/auth/dashboard-access'
import { cachedForAccount, CACHE_TTL, dashboardSummaryCacheTag } from '@/lib/cache/account-cache'
import { rangeForPreset, type PeriodPreset } from '@/lib/period'
import {
  loadCeoMetrics,
  loadCeoAlerts,
  loadSalesVsGoal,
  loadSalesFunnel,
  loadCommercialMetrics,
  loadTopSellers,
  loadLeadsByRep,
} from '@/lib/dashboard/ceo-queries'

// Matches the "few minutes of staleness is fine" trade-off the user
// signed off on: these are the heaviest queries on /dashboard (each
// scans/aggregates across deals, and some across every pipeline
// stage), recomputed from scratch on every page view today — with no
// account-level ceiling, that cost scales linearly with how many
// people have this page open, on top of how much data the account has
// accumulated. Shared across every viewer of the SAME account instead
// of per-request — see `cachedForAccount`'s doc comment for the
// caching mechanics and its single-instance caveat.
const STALE_DAYS_DEFAULT = 7

/**
 * GET /api/dashboard/ceo-summary?preset=thisMonth[&start=...&end=...][&staleDays=7]
 *                                (viewer+)
 *
 * Cached backing for the /dashboard page's sales/CEO section
 * (salesKpis, salesVsGoal, salesFunnel, commercialMetrics, topSellers,
 * leadsByRep, alerts) — the seven `ceo-queries.ts` loaders the client
 * used to call directly from the browser on every mount, pathname
 * match, and tab-refocus.
 *
 * Caching strategy: every one of the seven loaders is computed (and
 * cached under an accountId + params key) regardless of what THIS
 * caller is allowed to see — the underlying numbers are identical for
 * every member of the account, only which ones get shown differ by
 * role. That's what lets a viewer's request and an owner's request for
 * the SAME account share one cache entry instead of each role paying
 * its own compute cost. Permission filtering happens on the way OUT,
 * against the response object, using the exact same
 * `canViewDashboardSection` rule the client already applies (belt-
 * and-suspenders: a client bug or a direct API call can't leak a
 * section this caller isn't allowed to see).
 */
export async function GET(request: Request) {
  try {
    const { supabase, accountId, role, userId } = await requireRole('viewer')
    const { can } = await loadDashboardAccess(supabase, { role, userId })

    const { searchParams } = new URL(request.url)
    const range = parseRange(searchParams)
    const staleDays = Number(searchParams.get('staleDays')) || STALE_DAYS_DEFAULT
    const rangeKey = `${range.start.toISOString()}:${range.end.toISOString()}`
    // Every cache entry below shares this tag so a single
    // `revalidateTag` call (the /revalidate route) evicts all of them
    // at once, regardless of range/key — see that route's doc comment
    // for why this exists: the 3-minute TTL alone left the dashboard
    // showing pre-move numbers for up to 3 minutes after a user dragged
    // a deal to a new stage.
    const tags = [dashboardSummaryCacheTag(accountId)]

    const getCeoMetrics = cachedForAccount(
      [accountId, 'ceo-metrics', rangeKey],
      CACHE_TTL.dashboardSummary,
      () => loadCeoMetrics(supabase, range),
      tags,
    )
    const getSalesVsGoal = cachedForAccount(
      [accountId, 'ceo-sales-vs-goal', rangeKey],
      CACHE_TTL.dashboardSummary,
      () => loadSalesVsGoal(supabase, range),
      tags,
    )
    const getTopSellers = cachedForAccount(
      [accountId, 'ceo-top-sellers', rangeKey],
      CACHE_TTL.dashboardSummary,
      () => loadTopSellers(supabase, range),
      tags,
    )
    // Not range-dependent (fixed trailing windows / current-state
    // snapshots) — mirrors the client's own loadAll, which calls these
    // three the same way regardless of the selected period.
    const getSalesFunnel = cachedForAccount(
      [accountId, 'ceo-sales-funnel'],
      CACHE_TTL.dashboardSummary,
      () => loadSalesFunnel(supabase),
      tags,
    )
    const getCommercialMetrics = cachedForAccount(
      [accountId, 'ceo-commercial-metrics'],
      CACHE_TTL.dashboardSummary,
      () => loadCommercialMetrics(supabase),
      tags,
    )
    const getLeadsByRep = cachedForAccount(
      [accountId, 'ceo-leads-by-rep'],
      CACHE_TTL.dashboardSummary,
      () => loadLeadsByRep(supabase),
      tags,
    )

    const [ceoMetrics, salesVsGoal, topSellers, salesFunnel, commercialMetrics, leadsByRep] =
      await Promise.all([
        getCeoMetrics(),
        getSalesVsGoal(),
        getTopSellers(),
        getSalesFunnel(),
        getCommercialMetrics(),
        getLeadsByRep(),
      ])

    // Alerts need the metrics bundle as input (same dependency the
    // client's loadAll already has) — cached separately since its key
    // also folds in staleDays.
    const getAlerts = cachedForAccount(
      [accountId, 'ceo-alerts', rangeKey, String(staleDays)],
      CACHE_TTL.dashboardSummary,
      () => loadCeoAlerts(supabase, ceoMetrics, staleDays),
      tags,
    )
    const alerts = await getAlerts()

    return NextResponse.json({
      ceoMetrics: can('salesKpis') || can('salesVsGoal') ? ceoMetrics : null,
      salesVsGoal: can('salesVsGoal') ? salesVsGoal : null,
      salesFunnel: can('salesFunnel') ? salesFunnel : null,
      commercialMetrics: can('commercialMetrics') ? commercialMetrics : null,
      topSellers: can('topSellers') ? topSellers : null,
      leadsByRep: can('leadsByRep') ? leadsByRep : null,
      alerts: can('alerts') ? alerts : null,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

function parseRange(searchParams: URLSearchParams) {
  const preset = (searchParams.get('preset') as PeriodPreset | null) ?? 'thisMonth'
  if (preset === 'custom') {
    const start = searchParams.get('start')
    const end = searchParams.get('end')
    if (start && end) {
      return rangeForPreset('custom', { start: new Date(start), end: new Date(end) })
    }
    return rangeForPreset('thisMonth')
  }
  return rangeForPreset(preset)
}
