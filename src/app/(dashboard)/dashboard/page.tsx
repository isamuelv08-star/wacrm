"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { DASHBOARD_RANGE_DAYS, type DashboardRangeDays } from '@/lib/dashboard/date-utils'
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
import { AnimatedNumber } from '@/components/dashboard/animated-number'
import { RevealSection } from '@/components/dashboard/reveal-section'
import { SkeletonCard } from '@/components/dashboard/skeleton'
import { QuickActions } from '@/components/dashboard/quick-actions'
import { ConversationsChart } from '@/components/dashboard/conversations-chart'
import { PipelineDonut } from '@/components/dashboard/pipeline-donut'
import { ResponseTimeCard } from '@/components/dashboard/response-time-card'
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

  // Global period selector — drives Response Time and the whole Sales
  // section (goal proration, top-seller quotas, sales-vs-goal
  // buckets). The four "Today" KPI cards above deliberately stay on
  // their own fixed daily window regardless of this (see loadMetrics
  // call in loadAll) — they're explicitly labeled "Today" and read as
  // live snapshots, not a trend the viewer would want to re-window.
  const [rangeDays, setRangeDays] = useState<DashboardRangeDays>(30)
  // Read inside `loadAll` instead of the state value directly, so
  // `loadAll` (used for the initial load, pathname changes, and
  // regained visibility) doesn't need `rangeDays` as a dependency —
  // otherwise switching the period would recreate `loadAll` and trip
  // the pathname effect below, reloading the ENTIRE dashboard (pipeline
  // donut, hot-unanswered, funnel, commercial metrics — none of which
  // are range-dependent) on every click instead of just the widgets
  // that actually care. `handleRangeDaysChange` further down is the
  // one place that actually reacts to a period change.
  const rangeDaysRef = useRef(rangeDays)
  useEffect(() => {
    rangeDaysRef.current = rangeDays
  }, [rangeDays])

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
    const currentRangeDays = rangeDaysRef.current

    // Kick everything off in parallel. Each block has its own
    // setState + finally so a slow query doesn't hold up faster
    // sections — each widget shows its own skeleton independently.
    void loadMetrics(db, 1)
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

    void loadResponseTime(db, currentRangeDays)
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

    void loadCeoMetrics(db, currentRangeDays)
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

    void loadSalesVsGoal(db, currentRangeDays)
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

    void loadTopSellers(db, currentRangeDays)
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

  // Live updates for the KPI row and the operational cards (Pipeline
  // Donut, Hot Unanswered) — these only ever refreshed on mount,
  // pathname change, or regained tab visibility, so a contact/deal
  // created or moved elsewhere in the app (another tab, a teammate,
  // an automation) left the numbers stale until one of those fired.
  // `messages` is deliberately excluded — it's high-volume enough
  // (every inbound/outbound message) that subscribing to it here
  // would reload the whole dashboard on every chat exchange, and
  // "messages sent today" doesn't need per-message granularity the
  // way "a new contact showed up" does.
  useEffect(() => {
    if (!accountId) return
    const supabase = createClient()
    const channel = supabase
      .channel(`dashboard-activity:${accountId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'contacts', filter: `account_id=eq.${accountId}` },
        () => loadAll(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversations', filter: `account_id=eq.${accountId}` },
        () => loadAll(),
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [accountId, loadAll])

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

  // Global period switch handler — only refetches the widgets that
  // actually depend on it (Response Time, and the Sales section's
  // metrics/goal chart/top sellers), not the whole dashboard. See the
  // `rangeDaysRef` note above for why `loadAll` itself can't be reused
  // here.
  const handleRangeDaysChange = useCallback(
    (r: DashboardRangeDays) => {
      setRangeDays(r)
      const db = createClient()

      setResponseTimeLoading(true)
      loadResponseTime(db, r)
        .then((res) => setResponseTime(res))
        .catch((err) => console.error('[dashboard] response time failed:', err))
        .finally(() => setResponseTimeLoading(false))

      if (!hasAnySalesAccess) return

      setCeoMetricsLoading(true)
      loadCeoMetrics(db, r)
        .then((m) => {
          setCeoMetrics(m)
          setAlertsLoading(true)
          void loadCeoAlerts(db, m, STALE_DAYS)
            .then((a) => setAlerts(a))
            .catch((err) => console.error('[dashboard] sales alerts failed:', err))
            .finally(() => setAlertsLoading(false))
        })
        .catch((err) => console.error('[dashboard] sales metrics failed:', err))
        .finally(() => setCeoMetricsLoading(false))

      setSalesVsGoalLoading(true)
      loadSalesVsGoal(db, r)
        .then((s) => setSalesVsGoal(s))
        .catch((err) => console.error('[dashboard] sales-vs-goal failed:', err))
        .finally(() => setSalesVsGoalLoading(false))

      setTopSellersLoading(true)
      loadTopSellers(db, r)
        .then((s) => setTopSellers(s))
        .catch((err) => console.error('[dashboard] top-sellers failed:', err))
        .finally(() => setTopSellersLoading(false))
    },
    [hasAnySalesAccess],
  )

  return (
    <div className="space-y-5">
      {/* Header — greets the signed-in user by name (falls back to a
          generic label while the profile is still loading / unset).
          The period selector on the right drives Response Time below
          and the whole Sales section — NOT the four "Today" KPI cards,
          which stay on their own fixed daily window (see loadAll). */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            {t('welcome', { name: profile?.full_name || t('defaultUser') })}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('description')}
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-lg bg-muted/60 p-1">
          {DASHBOARD_RANGE_DAYS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => handleRangeDaysChange(r)}
              className={
                'rounded-md px-2.5 py-1 text-xs font-medium transition-colors ' +
                (rangeDays === r
                  ? 'bg-secondary text-secondary-foreground'
                  : 'text-muted-foreground hover:text-foreground')
              }
            >
              {t(`period.${r}`)}
            </button>
          ))}
        </div>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {metricsLoading || !metrics ? (
          Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <MetricCard
              title={t('activeConversations')}
              value={<AnimatedNumber value={metrics.activeConversations.current} formatter={(n) => Math.round(n).toLocaleString()} />}
              icon={MessageSquare}
              tint="blue"
              description={t('activeConversationsDesc')}
              animationDelayMs={0}
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
              value={<AnimatedNumber value={metrics.newContactsToday.current} formatter={(n) => Math.round(n).toLocaleString()} />}
              icon={UserPlus}
              tint="green"
              description={t('newContactsTodayDesc')}
              animationDelayMs={80}
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
              value={<AnimatedNumber value={metrics.openDealsValue} formatter={(n) => formatCurrency(n, defaultCurrency)} />}
              icon={DollarSign}
              tint="purple"
              description={t('openDealsValueDesc')}
              animationDelayMs={160}
              subtitle={t('openDeals', { count: metrics.openDealsCount })}
            />
            <MetricCard
              title={t('messagesSentToday')}
              value={<AnimatedNumber value={metrics.messagesSentToday.current} formatter={(n) => Math.round(n).toLocaleString()} />}
              icon={Send}
              tint="amber"
              description={t('messagesSentTodayDesc')}
              animationDelayMs={240}
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

      {/* Charts row — Conversations, Pipeline Value, and Response Time
          together. items-stretch (the grid default) stretches every
          column to match the tallest sibling; h-full on each wrapper
          and on the inner panels makes all three actually fill that
          stretched height so their rounded borders line up. */}
      <RevealSection delayMs={80}>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <div className="h-full lg:col-span-6">
            <ConversationsChart
              series={series}
              loading={seriesLoading}
              range={range}
              onRangeChange={handleRangeChange}
            />
          </div>
          <div className="h-full lg:col-span-3">
            <PipelineDonut
              data={pipeline}
              loading={pipelineLoading}
              currency={defaultCurrency}
            />
          </div>
          <div className="h-full lg:col-span-3">
            <ResponseTimeCard data={responseTime} loading={responseTimeLoading} />
          </div>
        </div>
      </RevealSection>

      {/* Team + HOT leads waiting on a reply */}
      <RevealSection delayMs={200}>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          <div className="h-full lg:col-span-2">
            <TeamCard />
          </div>
          <div className="h-full lg:col-span-3">
            <HotUnansweredCard items={hotUnanswered} loading={hotUnansweredLoading} />
          </div>
        </div>
      </RevealSection>

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
                    value={<AnimatedNumber value={ceoMetrics.salesThisMonth.current} formatter={(n) => formatCurrency(n, defaultCurrency)} />}
                    icon={TrendingUp}
                    tint="green"
                    description={tCeo('salesDesc')}
                    animationDelayMs={0}
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
                    value={
                      ceoMetrics.goalThisMonth != null
                        ? <AnimatedNumber value={ceoMetrics.goalThisMonth} formatter={(n) => formatCurrency(n, defaultCurrency)} />
                        : '—'
                    }
                    icon={Target}
                    tint="blue"
                    description={tCeo('goalDesc')}
                    animationDelayMs={80}
                    subtitle={
                      ceoMetrics.goalAttainmentPct != null
                        ? tCeo('goalAttainment', { pct: ceoMetrics.goalAttainmentPct.toFixed(1) })
                        : tCeo('goalNotSet')
                    }
                  />
                  <MetricCard
                    title={tCeo('pipeline')}
                    value={<AnimatedNumber value={ceoMetrics.pipelineTotal} formatter={(n) => formatCurrency(n, defaultCurrency)} />}
                    icon={Handshake}
                    tint="purple"
                    description={tCeo('pipelineDesc')}
                    animationDelayMs={160}
                    subtitle={
                      ceoMetrics.pipelineCoverage != null
                        ? tCeo('pipelineCoverage', { multiple: ceoMetrics.pipelineCoverage.toFixed(1) })
                        : undefined
                    }
                  />
                  <MetricCard
                    title={tCeo('forecast')}
                    value={<AnimatedNumber value={ceoMetrics.forecast} formatter={(n) => formatCurrency(n, defaultCurrency)} />}
                    icon={TrendingUp}
                    tint="amber"
                    description={tCeo('forecastDesc')}
                    animationDelayMs={240}
                    subtitle={ceoMetrics.forecastPct != null ? tCeo('forecastOfGoal', { pct: ceoMetrics.forecastPct.toFixed(0) }) : undefined}
                  />
                  <MetricCard
                    title={tCeo('clients')}
                    value={<AnimatedNumber value={ceoMetrics.totalClients} formatter={(n) => Math.round(n).toLocaleString()} />}
                    icon={Users2}
                    tint="teal"
                    description={tCeo('clientsDesc')}
                    animationDelayMs={320}
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
            <RevealSection delayMs={80}>
              <SalesVsGoalChart data={salesVsGoal} loading={salesVsGoalLoading} currency={defaultCurrency} />
            </RevealSection>
          )}

          {sales.funnel && (
            <RevealSection delayMs={140}>
              <SalesFunnel data={funnel} loading={funnelLoading} currency={defaultCurrency} />
            </RevealSection>
          )}

          {(sales.commercial || sales.alerts) && (
            <RevealSection delayMs={200}>
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
            </RevealSection>
          )}

          {sales.topSellers && (
            <RevealSection delayMs={260}>
              <TopSellersCard data={topSellers} loading={topSellersLoading} currency={defaultCurrency} />
            </RevealSection>
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
  if (delta === 0) return t('noChangeVsPrevious')
  const sign = delta > 0 ? '+' : ''
  return `${sign}${formatCurrency(delta, currency)} ${t('vsPreviousPeriod')}`
}

function ceoDeltaCountLabel(delta: number, t: ReturnType<typeof useTranslations>): string {
  if (delta === 0) return t('noChangeVsPrevious')
  const sign = delta > 0 ? '+' : ''
  return `${sign}${delta.toLocaleString()} ${t('vsPreviousPeriod')}`
}
