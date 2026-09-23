import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { cachedForAccount, CACHE_TTL } from '@/lib/cache/account-cache'
import { rangeForPreset, type PeriodPreset } from '@/lib/period'
import { loadCeoMetrics, loadPeriodCommercialTrend } from '@/lib/dashboard/ceo-queries'

/**
 * GET /api/manager/decision-center?preset=last7Days[&start=...&end=...]
 *                                  (admin+)
 *
 * Backing data for Centro de Decisiones — a SEPARATE endpoint from
 * /api/dashboard/ceo-summary (not a mode of it): that route's cache
 * entries and permission-per-widget filtering exist for the plain
 * /dashboard page's own contract, and this page has a materially
 * different one (admin+ only, one period selector driving every
 * section, no per-widget dashboard_permissions to check — the whole
 * page is the permission boundary, enforced again here as defense in
 * depth alongside the page's own server-side gate).
 *
 * Built stage by stage alongside the page itself — this first stage
 * only returns `kpis` (Section 1, "¿Cómo está tu negocio?"). Later
 * stages add `interpretation`, `decisions`, `breakdown`, `money`,
 * `team`, `todayPriorities` to this SAME response, reusing this same
 * cached call — see the Centro de Decisiones plan for the section
 * order.
 */
export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')

    const { searchParams } = new URL(request.url)
    const range = parseRange(searchParams)
    const rangeKey = `${range.start.toISOString()}:${range.end.toISOString()}`

    const getKpis = cachedForAccount(
      [accountId, 'decision-center-kpis', rangeKey],
      CACHE_TTL.decisionCenter,
      async () => {
        const [ceoMetrics, trend] = await Promise.all([
          loadCeoMetrics(supabase, range),
          loadPeriodCommercialTrend(supabase, range),
        ])
        return {
          sales: ceoMetrics.salesThisMonth,
          leads: ceoMetrics.newClients,
          conversion: trend.winRatePct,
          avgTicket: trend.avgTicket,
          opportunities: trend.opportunitiesCreated,
        }
      },
    )

    const kpis = await getKpis()

    return NextResponse.json({
      range: { label: range.label, start: range.start.toISOString(), end: range.end.toISOString() },
      kpis,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

function parseRange(searchParams: URLSearchParams) {
  const preset = (searchParams.get('preset') as PeriodPreset | null) ?? 'last7Days'
  if (preset === 'custom') {
    const start = searchParams.get('start')
    const end = searchParams.get('end')
    if (start && end) {
      return rangeForPreset('custom', { start: new Date(start), end: new Date(end) })
    }
    return rangeForPreset('last7Days')
  }
  return rangeForPreset(preset)
}
