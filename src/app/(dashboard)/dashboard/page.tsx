"use client"

import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-auth'
import { formatCurrency } from '@/lib/currency'
import {
  MessageSquare,
  UserPlus,
  DollarSign,
  Send,
  Handshake,
  Target,
  TrendingUp,
  Users2,
} from 'lucide-react'

import {
  loadConversationsSeries,
  loadHotUnanswered,
  loadMetrics,
  loadPipelineDonut,
  loadResponseTime,
} from '@/lib/dashboard/queries'
import {
  loadCeoAlerts,
  loadCeoMetrics,
  loadCommercialMetrics,
  loadSalesFunnel,
  loadSalesVsGoal,
  loadTopSellers,
} from '@/lib/dashboard/ceo-queries'
import type {
  ConversationsSeriesPoint,
  HotUnansweredItem,
  MetricsBundle,
  PipelineDonutData,
  ResponseTimeSummary,
} from '@/lib/dashboard/types'
import type {
  CeoAlerts,
  CeoMetrics,
  CommercialMetrics,
  FunnelStep,
  SalesVsGoalPoint,
  TopSeller,
} from '@/lib/dashboard/ceo-types'

import { MetricCard } from '@/components/dashboard/metric-card'
import { SkeletonCard } from '@/components/dashboard/skeleton'
import { QuickActions } from '@/components/dashboard/quick-actions'
import { ConversationsChart } from '@/components/dashboard/conversations-chart'
import { PipelineDonut } from '@/components/dashboard/pipeline-donut'
import { ResponseTimeChart } from '@/components/dashboard/response-time-chart'
import { HotUnansweredCard } from '@/components/dashboard/hot-unanswered-card'
import { TeamCard } from '@/components/dashboard/team-card'
import { SalesVsGoalChart } from '@/components/dashboard/ceo/sales-vs-goal-chart'
import { SalesFunnel } from '@/components/dashboard/ceo/sales-funnel'
import { CommercialMetricsCard } from '@/components/dashboard/ceo/commercial-metrics-card'
import { TopSellersCard } from '@/components/dashboard/ceo/top-sellers-card'
import { AlertsCard } from '@/components/dashboard/ceo/alerts-card'

import { useTranslations } from 'next-intl'

type RangeDays = 7 | 30 | 90

// Open deals sitting untouched this long count as "stalled" in the
// sales Alerts card.
const STALE_DAYS = 7

export default function DashboardPage() {
  const t = useTranslations('Dashboard.page')
  const tCeo = useTranslations('Dashboard.ceo.page')
  const { profile, defaultCurrency, accountId, canViewDashboardSection } = useAuth()

  // One /dashboard for everyone — what used to be a separate
  // owner-only /ceo page is now just a section of this page, gated
  // per-widget instead of per-route (see migration 054 / Settings →
  // Team members' per-member "dashboard access" editor). `sales`
  // groups the six checks so the loaders/JSX below don't repeat the
  // `canViewDashboardSection(...)` call six times each.
  const sales = useMemo(
    () => ({
      kpis: canViewDashboardSection('salesKpis'),
      vsGoal: canViewDashboardSection('salesVsGoal'),
      funnel: canViewDashboardSection('salesFunnel'),
      commercial: canViewDashboardSection('commercialMetrics'),
      topSellers: canViewDashboardSection('topSellers'),
      alerts: canViewDashboardSection('alerts'),
    }),
    [canViewDashboardSection],
  )
  const hasAnySalesAccess =
    sales.kpis || sales.vsGoal || sales.funnel || sales.commercial || sales.topSellers || sales.alerts

  const [metrics, setMetrics] = useState<MetricsBundle | null>(null)
  const [metricsLoading, setMetricsLoading] = useState(true)

  const [range, setRange] = useState<RangeDays>(30)
  // Keep a cache per range so switching tabs doesn't re-fetch what we
  // already have. Ranges the user hasn't opened yet stay null and
  // trigger a fetch on first view.
  const [series, setSeries] = useState<Record<RangeDays, ConversationsSeriesPoint[] | null>>({
    7: null,
    30: null,
    90: null,
  })
  const [seriesLoading, setSeriesLoading] = useState(true)

  const [pipeline, setPipeline] = useState<PipelineDonutData | null>(null)
  const [pipelineLoading, setPipelineLoading] = useState(true)

  const [responseTime, setResponseTime] = useState<ResponseTimeSummary | null>(null)
  const [responseTimeLoading, setResponseTimeLoading] = useState(true)

  const [hotUnanswered, setHotUnanswered] = useState<HotUnansweredItem[] | null>(null)
  const [hotUnansweredLoading, setHotUnansweredLoading] = useState(true)

  // Sales section state — only ever fetched when `hasAnySalesAccess`.
  const [ceoMetrics, setCeoMetrics] = useState<CeoMetrics | null>(null)
  const [ceoMetricsLoading, setCeoMetricsLoading] = useState(true)
  const [salesVsGoal, setSalesVsGoal] = useState<SalesVsGoalPoint[] | null>(null)
  const [salesVsGoalLoading, setSalesVsGoalLoading] = useState(true)
  const [funnel, setFunnel] = useState<FunnelStep[] | null>(null)
  const [funnelLoading, setFunnelLoading] = useState(true)
  const [commercial, setCommercial] = useState<CommercialMetrics | null>(null)
  const [commercialLoading, setCommercialLoading] = useState(true)
  const [topSellers, setTopSellers] = useState<TopSeller[] | null>(null)
  const [topSellersLoading, setTopSellersLoading] = useState(true)
  const [alerts, setAlerts] = useState<CeoAlerts | null>(null)
  const [alertsLoading, setAlertsLoading] = useState(true)

  const loadAll = useCallback(() => {
    const db = createClient()

    // Kick everything off in parallel. Each block has its own
    // setState + finally so a slow query doesn't hold up faster
    // sections — each widget shows its own skeleton independently.
    void loadMetrics(db)
      .then((m) => setMetrics(m))
      .catch((err) => console.error('[dashboard] metrics failed:', err))
      .finally(() => setMetricsLoading(false))

    void loadConversationsSeries(db, 30)
      .then((s) => setSeries((prev) => ({ ...prev, 30: s })))
      .catch((err) => console.error('[dashboard] series failed:', err))
      .finally(() => setSeriesLoading(false))

    void loadPipelineDonut(db)
      .then((p) => setPipeline(p))
      .catch((err) => console.error('[dashboard] pipeline failed:', err))
      .finally(() => setPipelineLoading(false))

    void loadResponseTime(db)
      .then((r) => setResponseTime(r))
      .catch((err) => console.error('[dashboard] response time failed:', err))
      .finally(() => setResponseTimeLoading(false))

    void loadHotUnanswered(db)
      .then((h) => setHotUnanswered(h))
      .catch((err) => console.error('[dashboard] hot-unanswered failed:', err))
      .finally(() => setHotUnansweredLoading(false))

    if (!hasAnySalesAccess) {
      setCeoMetricsLoading(false)
      setSalesVsGoalLoading(false)
      setFunnelLoading(false)
      setCommercialLoading(false)
      setTopSellersLoading(false)
      setAlertsLoading(false)
      return
    }

    void loadCeoMetrics(db)
      .then((m) => {
        setCeoMetrics(m)
        // Alerts need the full metrics bundle this same call already
        // computed — fetch it right after instead of re-scanning
        // open deals a second time.
        setAlertsLoading(true)
        void loadCeoAlerts(db, m, STALE_DAYS)
          .then((a) => setAlerts(a))
          .catch((err) => console.error('[dashboard] sales alerts failed:', err))
          .finally(() => setAlertsLoading(false))
      })
      .catch((err) => console.error('[dashboard] sales metrics failed:', err))
      .finally(() => setCeoMetricsLoading(false))

    void loadSalesVsGoal(db, 6)
      .then((s) => setSalesVsGoal(s))
      .catch((err) => console.error('[dashboard] sales-vs-goal failed:', err))
      .finally(() => setSalesVsGoalLoading(false))

    void loadSalesFunnel(db)
      .then((f) => setFunnel(f))
      .catch((err) => console.error('[dashboard] funnel failed:', err))
      .finally(() => setFunnelLoading(false))

    void loadCommercialMetrics(db)
      .then((c) => setCommercial(c))
      .catch((err) => console.error('[dashboard] commercial metrics failed:', err))
      .finally(() => setCommercialLoading(false))

    void loadTopSellers(db)
      .then((s) => setTopSellers(s))
      .catch((err) => console.error('[dashboard] top-sellers failed:', err))
      .finally(() => setTopSellersLoading(false))
  }, [hasAnySalesAccess])

  // Re-fetch every time this route becomes the active page — not just
  // on first mount. Next's client router cache can keep this page's
  // component instance alive when the user navigates away and back
  // within the app, so a mount-only effect would silently show stale
  // numbers on return. Keying on `pathname` re-runs the load whenever
  // navigation lands back on /dashboard, even if the instance survived.
  const pathname = usePathname()
  useEffect(() => {
    if (pathname === '/dashboard') loadAll()
  }, [pathname, loadAll])

  // Belt-and-suspenders for the same staleness: a backgrounded browser
  // tab can sit for a long time before the user returns to it. Refresh
  // on regaining visibility too, matching the pattern already used by
  // the inbox and broadcasts pages.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') loadAll()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [loadAll])

  // Live updates for the sales section — a deal closing or a goal
  // being edited anywhere in the app should reflect here without a
  // manual refresh. Same `postgres_changes` + account-scoped filter
  // pattern as usePresence/message-thread; the payload isn't used
  // directly, it just triggers a reload since so many KPIs derive
  // from the same underlying deal rows. Skipped entirely for viewers
  // with no sales access — no point subscribing to data they can't see.
  useEffect(() => {
    if (!accountId || !hasAnySalesAccess) return
    const supabase = createClient()
    const channel = supabase
      .channel(`dashboard-sales:${accountId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'deals', filter: `account_id=eq.${accountId}` },
        () => loadAll(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'sales_goals', filter: `account_id=eq.${accountId}` },
        () => loadAll(),
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [accountId, hasAnySalesAccess, loadAll])

  // Range switch handler — kept in an event callback (not an effect)
  // so the setState calls stay out of the react-hooks/set-state-in-effect
  // rule's way. The cached bucket check means switching back to a
  // previously-viewed range is instant and doesn't re-fetch.
  const handleRangeChange = useCallback(
    (r: RangeDays) => {
      setRange(r)
      if (series[r] !== null) return
      setSeriesLoading(true)
      const db = createClient()
      loadConversationsSeries(db, r)
        .then((s) => setSeries((prev) => ({ ...prev, [r]: s })))
        .catch((err) => console.error('[dashboard] series failed:', err))
        .finally(() => setSeriesLoading(false))
    },
    [series],
  )

  return (
    <div className="space-y-5">
      {/* Header — greets the signed-in user by name (falls back to a
          generic label while the profile is still loading / unset). */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">
          {t('welcome', { name: profile?.full_name || t('defaultUser') })}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('description')}
        </p>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {metricsLoading || !metrics ? (
          Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <MetricCard
              title={t('activeConversations')}
              value={metrics.activeConversations.current.toLocaleString()}
              icon={MessageSquare}
              tint="blue"
              delta={{
                sign: metrics.activeConversations.previous,
                label: deltaLabel(
                  metrics.activeConversations.previous,
                  t('newTodayVsYesterday'),
                  t('noChange', { suffix: t('newTodayVsYesterday') })
                ),
              }}
            />
            <MetricCard
              title={t('newContactsToday')}
              value={metrics.newContactsToday.current.toLocaleString()}
              icon={UserPlus}
              tint="green"
              delta={{
                sign:
                  metrics.newContactsToday.current - metrics.newContactsToday.previous,
                label: deltaLabel(
                  metrics.newContactsToday.current - metrics.newContactsToday.previous,
                  t('vsYesterday'),
                  t('noChange', { suffix: t('vsYesterday') })
                ),
              }}
            />
            <MetricCard
              title={t('openDealsValue')}
              value={formatCurrency(metrics.openDealsValue, defaultCurrency)}
              icon={DollarSign}
              tint="purple"
              subtitle={t('openDeals', { count: metrics.openDealsCount })}
            />
            <MetricCard
              title={t('messagesSentToday')}
              value={metrics.messagesSentToday.current.toLocaleString()}
              icon={Send}
              tint="amber"
              delta={{
                sign:
                  metrics.messagesSentToday.current - metrics.messagesSentToday.previous,
                label: deltaLabel(
                  metrics.messagesSentToday.current - metrics.messagesSentToday.previous,
                  t('vsYesterday'),
                  t('noChange', { suffix: t('vsYesterday') })
                ),
              }}
            />
          </>
        )}
      </div>

      {/* Quick actions */}
      <QuickActions />

      {/* Charts row */}
      {/* items-stretch (the grid default) stretches the two columns to
          match the tallest sibling; adding h-full on each wrapper and
          on the inner panels makes both cards actually fill that
          stretched height so their rounded borders line up. Without
          this, the pipeline card rendered at its natural (shorter)
          height while the line chart drove the row height. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <div className="h-full lg:col-span-3">
          <ConversationsChart
            series={series}
            loading={seriesLoading}
            range={range}
            onRangeChange={handleRangeChange}
          />
        </div>
        <div className="h-full lg:col-span-2">
          <PipelineDonut
            data={pipeline}
            loading={pipelineLoading}
            currency={defaultCurrency}
          />
        </div>
      </div>

      {/* Response time */}
      <ResponseTimeChart data={responseTime} loading={responseTimeLoading} />

      {/* Team + HOT leads waiting on a reply */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <div className="h-full lg:col-span-2">
          <TeamCard />
        </div>
        <div className="h-full lg:col-span-3">
          <HotUnansweredCard items={hotUnanswered} loading={hotUnansweredLoading} />
        </div>
      </div>

      {/* Sales section — visible only to whoever has at least one of
          the six sales-widget permissions (owner always does; see
          Settings → Team members to grant others). Not a separate
          page: everyone lands on the same /dashboard, this block
          simply doesn't render for people without any sales access. */}
      {hasAnySalesAccess && (
        <div className="space-y-4 border-t border-border pt-5">
          <h2 className="text-lg font-semibold text-foreground">{tCeo('salesSectionTitle')}</h2>

          {sales.kpis && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {ceoMetricsLoading || !ceoMetrics ? (
                Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)
              ) : (
                <>
                  <MetricCard
                    title={tCeo('sales')}
                    value={formatCurrency(ceoMetrics.salesThisMonth.current, defaultCurrency)}
                    icon={TrendingUp}
                    tint="green"
                    delta={{
                      sign: ceoMetrics.salesThisMonth.current - ceoMetrics.salesThisMonth.previous,
                      label: ceoDeltaLabel(
                        ceoMetrics.salesThisMonth.current - ceoMetrics.salesThisMonth.previous,
                        defaultCurrency,
                        tCeo,
                      ),
                    }}
                  />
                  <MetricCard
                    title={tCeo('goal')}
                    value={ceoMetrics.goalThisMonth != null ? formatCurrency(ceoMetrics.goalThisMonth, defaultCurrency) : '—'}
                    icon={Target}
                    tint="blue"
                    subtitle={
                      ceoMetrics.goalAttainmentPct != null
                        ? tCeo('goalAttainment', { pct: ceoMetrics.goalAttainmentPct.toFixed(1) })
                        : tCeo('goalNotSet')
                    }
                  />
                  <MetricCard
                    title={tCeo('pipeline')}
                    value={formatCurrency(ceoMetrics.pipelineTotal, defaultCurrency)}
                    icon={Handshake}
                    tint="purple"
                    subtitle={
                      ceoMetrics.pipelineCoverage != null
                        ? tCeo('pipelineCoverage', { multiple: ceoMetrics.pipelineCoverage.toFixed(1) })
                        : undefined
                    }
                  />
                  <MetricCard
                    title={tCeo('forecast')}
                    value={formatCurrency(ceoMetrics.forecast, defaultCurrency)}
                    icon={TrendingUp}
                    tint="amber"
                    subtitle={ceoMetrics.forecastPct != null ? tCeo('forecastOfGoal', { pct: ceoMetrics.forecastPct.toFixed(0) }) : undefined}
                  />
                  <MetricCard
                    title={tCeo('clients')}
                    value={ceoMetrics.totalClients.toLocaleString()}
                    icon={Users2}
                    tint="teal"
                    delta={{
                      sign: ceoMetrics.newClients.current - ceoMetrics.newClients.previous,
                      label: ceoDeltaCountLabel(ceoMetrics.newClients.current - ceoMetrics.newClients.previous, tCeo),
                    }}
                  />
                </>
              )}
            </div>
          )}

          {sales.vsGoal && (
            <SalesVsGoalChart data={salesVsGoal} loading={salesVsGoalLoading} currency={defaultCurrency} />
          )}

          {sales.funnel && (
            <SalesFunnel data={funnel} loading={funnelLoading} currency={defaultCurrency} />
          )}

          {(sales.commercial || sales.alerts) && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
              {sales.commercial && (
                <div className={sales.alerts ? 'h-full lg:col-span-2' : 'h-full'}>
                  <CommercialMetricsCard data={commercial} loading={commercialLoading} currency={defaultCurrency} />
                </div>
              )}
              {sales.alerts && (
                <div className={sales.commercial ? 'h-full lg:col-span-3' : 'h-full'}>
                  <AlertsCard data={alerts} loading={alertsLoading} currency={defaultCurrency} staleDays={STALE_DAYS} />
                </div>
              )}
            </div>
          )}

          {sales.topSellers && (
            <TopSellersCard data={topSellers} loading={topSellersLoading} currency={defaultCurrency} />
          )}
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------

function deltaLabel(delta: number, suffix: string, noChangeLabel: string): string {
  if (delta === 0) return noChangeLabel
  const sign = delta > 0 ? '+' : ''
  return `${sign}${delta.toLocaleString()} ${suffix}`
}

function ceoDeltaLabel(
  delta: number,
  currency: string,
  t: ReturnType<typeof useTranslations>,
): string {
  if (delta === 0) return t('noChangeVsLastMonth')
  const sign = delta > 0 ? '+' : ''
  return `${sign}${formatCurrency(delta, currency)} ${t('vsLastMonth')}`
}

function ceoDeltaCountLabel(delta: number, t: ReturnType<typeof useTranslations>): string {
  if (delta === 0) return t('noChangeVsLastMonth')
  const sign = delta > 0 ? '+' : ''
  return `${sign}${delta.toLocaleString()} ${t('vsLastMonth')}`
}
