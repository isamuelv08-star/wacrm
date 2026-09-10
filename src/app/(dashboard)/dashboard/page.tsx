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
  loadFollowupLeads,
  loadHotUnanswered,
  loadLeadsQualifiedToday,
  loadMetrics,
  loadPipelineDonut,
  loadResponseTime,
} from '@/lib/dashboard/queries'
import { rangeForPreset, formatRangeLabel, type PeriodPreset, type PeriodRange } from '@/lib/period'
import { PeriodSelector } from '@/components/period-selector'
import { useDebouncedCallback } from '@/hooks/use-debounced-callback'
import type {
  ConversationsSeriesPoint,
  FollowupSummary,
  HotUnansweredItem,
  LeadsQualifiedToday,
  MetricsBundle,
  PipelineDonutData,
  ResponseTimeSummary,
} from '@/lib/dashboard/types'
import type {
  CeoAlerts,
  CeoMetrics,
  CommercialMetrics,
  LeadsByRep,
  SalesFunnelData,
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
import { LeadsQualifiedTodayCard } from '@/components/dashboard/leads-qualified-today-card'
import { FollowupCard } from '@/components/dashboard/followup-card'
import { TeamCard } from '@/components/dashboard/team-card'
import { SalesVsGoalChart } from '@/components/dashboard/ceo/sales-vs-goal-chart'
import { SalesFunnel } from '@/components/dashboard/ceo/sales-funnel'
import { CommercialMetricsCard } from '@/components/dashboard/ceo/commercial-metrics-card'
import { TopSellersCard } from '@/components/dashboard/ceo/top-sellers-card'
import { LeadsByRepCard } from '@/components/dashboard/ceo/leads-by-rep-card'
import { AlertsCard } from '@/components/dashboard/ceo/alerts-card'

import { useTranslations } from 'next-intl'

type RangeDays = 7 | 30 | 90

// Open deals sitting untouched this long count as "stalled" in the
// sales Alerts card.
const STALE_DAYS = 7

interface CeoSummaryResponse {
  ceoMetrics: CeoMetrics | null
  salesVsGoal: SalesVsGoalPoint[] | null
  salesFunnel: SalesFunnelData | null
  commercialMetrics: CommercialMetrics | null
  topSellers: TopSeller[] | null
  leadsByRep: LeadsByRep[] | null
  alerts: CeoAlerts | null
}

/**
 * Fetch the sales/CEO section from the cached `/api/dashboard/ceo-summary`
 * route instead of hitting Supabase directly for each of its seven
 * metrics — see that route's doc comment for the caching + permission
 * strategy. `customRange` is required whenever `range.label ===
 * 'custom'`: `range.start`/`.end` are already day-truncated /
 * exclusive-end-adjusted by `rangeForPreset`, so re-sending THOSE as
 * if they were raw picker input would apply that adjustment twice on
 * the server.
 */
async function fetchCeoSummary(
  range: PeriodRange,
  staleDays: number,
  customRange?: { start: string; end: string },
): Promise<CeoSummaryResponse> {
  const params = new URLSearchParams({ preset: range.label, staleDays: String(staleDays) })
  if (range.label === 'custom' && customRange) {
    params.set('start', customRange.start)
    params.set('end', customRange.end)
  }
  const res = await fetch(`/api/dashboard/ceo-summary?${params.toString()}`)
  if (!res.ok) throw new Error(`ceo-summary request failed: ${res.status}`)
  return res.json() as Promise<CeoSummaryResponse>
}

export default function DashboardPage() {
  const t = useTranslations('Dashboard.page')
  const tCeo = useTranslations('Dashboard.ceo.page')
  const tPeriod = useTranslations('Common.period')
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
      leadsByRep: canViewDashboardSection('leadsByRep'),
      alerts: canViewDashboardSection('alerts'),
    }),
    [canViewDashboardSection],
  )
  const hasAnySalesAccess =
    sales.kpis || sales.vsGoal || sales.funnel || sales.commercial || sales.topSellers ||
    sales.leadsByRep || sales.alerts

  const [metrics, setMetrics] = useState<MetricsBundle | null>(null)
  const [metricsLoading, setMetricsLoading] = useState(true)

  // Global period selector — same calendar-based preset + custom-range
  // picker as Pipeline Analytics (see `@/lib/period`), so "this month"
  // / "last month" / "this quarter" / "this year" / "all time" / a
  // custom date pick all resolve to a real `[start, end)` range instead
  // of a rolling "last N days" window. Drives Response Time and the
  // whole Sales section (goal proration, top-seller quotas, sales-vs-
  // goal buckets). The four "Today" KPI cards above deliberately stay
  // on their own fixed daily window regardless of this (see loadMetrics
  // call in loadAll) — they're explicitly labeled "Today" and read as
  // live snapshots, not a trend the viewer would want to re-window.
  const [preset, setPreset] = useState<PeriodPreset>('thisMonth')
  // Seeded to today so flipping to "Custom" always starts from a valid
  // (if trivial) range instead of two empty date inputs.
  const [customStart, setCustomStart] = useState(todayIso())
  const [customEnd, setCustomEnd] = useState(todayIso())

  const periodRange: PeriodRange = useMemo(() => {
    if (preset === 'custom' && customStart && customEnd) {
      return rangeForPreset('custom', { start: new Date(customStart), end: new Date(customEnd) })
    }
    return rangeForPreset(preset === 'custom' ? 'thisMonth' : preset)
  }, [preset, customStart, customEnd])

  const periodRangeLabel = useMemo(() => formatRangeLabel(periodRange, tPeriod), [periodRange, tPeriod])

  // Read inside `loadAll` instead of the state value directly, so
  // `loadAll` (used for the initial load, pathname changes, and
  // regained visibility) doesn't need `periodRange` as a dependency —
  // otherwise switching the period would recreate `loadAll` and trip
  // the pathname effect below, reloading the ENTIRE dashboard (pipeline
  // donut, hot-unanswered, funnel, commercial metrics — none of which
  // are range-dependent) on every click instead of just the widgets
  // that actually care. `handlePeriodChange` further down is the
  // one place that actually reacts to a period change.
  const periodRangeRef = useRef(periodRange)
  useEffect(() => {
    periodRangeRef.current = periodRange
  }, [periodRange])

  // Same ref-read trick, for the ceo-summary fetch below: it needs the
  // RAW custom start/end strings (not periodRange.start/.end, which
  // are already day-truncated/exclusive-end-adjusted by rangeForPreset
  // — sending those back through rangeForPreset('custom', ...) a
  // second time server-side would apply that adjustment twice).
  const customRangeRef = useRef({ start: customStart, end: customEnd })
  useEffect(() => {
    customRangeRef.current = { start: customStart, end: customEnd }
  }, [customStart, customEnd])

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
  // Same ref-read trick as `periodRangeRef` above: `loadAll` needs to
  // know which tab is currently visible without depending on `range`
  // directly, which would recreate it and re-trip the pathname effect.
  const rangeRef = useRef(range)
  useEffect(() => {
    rangeRef.current = range
  }, [range])

  const [pipeline, setPipeline] = useState<PipelineDonutData | null>(null)
  const [pipelineLoading, setPipelineLoading] = useState(true)

  const [responseTime, setResponseTime] = useState<ResponseTimeSummary | null>(null)
  const [responseTimeLoading, setResponseTimeLoading] = useState(true)

  const [hotUnanswered, setHotUnanswered] = useState<HotUnansweredItem[] | null>(null)
  const [hotUnansweredLoading, setHotUnansweredLoading] = useState(true)

  const [leadsQualifiedToday, setLeadsQualifiedToday] = useState<LeadsQualifiedToday | null>(null)
  const [leadsQualifiedTodayLoading, setLeadsQualifiedTodayLoading] = useState(true)

  const [followup, setFollowup] = useState<FollowupSummary | null>(null)
  const [followupLoading, setFollowupLoading] = useState(true)

  // Sales section state — only ever fetched when `hasAnySalesAccess`.
  const [ceoMetrics, setCeoMetrics] = useState<CeoMetrics | null>(null)
  const [ceoMetricsLoading, setCeoMetricsLoading] = useState(true)
  const [salesVsGoal, setSalesVsGoal] = useState<SalesVsGoalPoint[] | null>(null)
  const [salesVsGoalLoading, setSalesVsGoalLoading] = useState(true)
  const [funnel, setFunnel] = useState<SalesFunnelData | null>(null)
  const [funnelLoading, setFunnelLoading] = useState(true)
  const [commercial, setCommercial] = useState<CommercialMetrics | null>(null)
  const [commercialLoading, setCommercialLoading] = useState(true)
  const [topSellers, setTopSellers] = useState<TopSeller[] | null>(null)
  const [topSellersLoading, setTopSellersLoading] = useState(true)
  const [leadsByRep, setLeadsByRep] = useState<LeadsByRep[] | null>(null)
  const [leadsByRepLoading, setLeadsByRepLoading] = useState(true)
  const [alerts, setAlerts] = useState<CeoAlerts | null>(null)
  const [alertsLoading, setAlertsLoading] = useState(true)

  const loadAll = useCallback(() => {
    const db = createClient()
    const currentRange = periodRangeRef.current

    // Kick everything off in parallel. Each block has its own
    // setState + finally so a slow query doesn't hold up faster
    // sections — each widget shows its own skeleton independently.
    void loadMetrics(db, 1)
      .then((m) => setMetrics(m))
      .catch((err) => console.error('[dashboard] metrics failed:', err))
      .finally(() => setMetricsLoading(false))

    // Refresh whichever tab (7/30/90) is actually being viewed — was
    // hardcoded to 30 regardless of `range`, so switching to 7 or 90
    // days and then having loadAll re-run (pathname change, regained
    // visibility, a sales realtime event) silently kept showing that
    // tab's stale cache forever. Invalidate the other two cached
    // buckets at the same time so switching to them re-fetches fresh
    // data instead of serving what could now be stale, without paying
    // to refresh all three simultaneously.
    const viewedRange = rangeRef.current
    void loadConversationsSeries(db, viewedRange)
      .then((s) => setSeries({ 7: null, 30: null, 90: null, [viewedRange]: s }))
      .catch((err) => console.error('[dashboard] series failed:', err))
      .finally(() => setSeriesLoading(false))

    void loadPipelineDonut(db)
      .then((p) => setPipeline(p))
      .catch((err) => console.error('[dashboard] pipeline failed:', err))
      .finally(() => setPipelineLoading(false))

    void loadResponseTime(db, currentRange)
      .then((r) => setResponseTime(r))
      .catch((err) => console.error('[dashboard] response time failed:', err))
      .finally(() => setResponseTimeLoading(false))

    void loadHotUnanswered(db)
      .then((h) => setHotUnanswered(h))
      .catch((err) => console.error('[dashboard] hot-unanswered failed:', err))
      .finally(() => setHotUnansweredLoading(false))

    // Compact card (third slot alongside Team + HOT leads waiting).
    void loadLeadsQualifiedToday(db)
      .then((d) => setLeadsQualifiedToday(d))
      .catch((err) => console.error('[dashboard] leads qualified today failed:', err))
      .finally(() => setLeadsQualifiedTodayLoading(false))

    void loadFollowupLeads(db)
      .then((d) => setFollowup(d))
      .catch((err) => console.error('[dashboard] followup leads failed:', err))
      .finally(() => setFollowupLoading(false))

    if (!hasAnySalesAccess) {
      setCeoMetricsLoading(false)
      setSalesVsGoalLoading(false)
      setFunnelLoading(false)
      setCommercialLoading(false)
      setTopSellersLoading(false)
      setLeadsByRepLoading(false)
      setAlertsLoading(false)
      return
    }

    // One cached round trip for all seven sales/CEO widgets instead of
    // seven direct Supabase calls — see fetchCeoSummary's doc comment.
    void fetchCeoSummary(currentRange, STALE_DAYS, customRangeRef.current)
      .then((data) => {
        setCeoMetrics(data.ceoMetrics)
        setSalesVsGoal(data.salesVsGoal)
        setFunnel(data.salesFunnel)
        setCommercial(data.commercialMetrics)
        setTopSellers(data.topSellers)
        setLeadsByRep(data.leadsByRep)
        setAlerts(data.alerts)
      })
      .catch((err) => console.error('[dashboard] ceo-summary failed:', err))
      .finally(() => {
        setCeoMetricsLoading(false)
        setSalesVsGoalLoading(false)
        setFunnelLoading(false)
        setCommercialLoading(false)
        setTopSellersLoading(false)
        setLeadsByRepLoading(false)
        setAlertsLoading(false)
      })
  }, [hasAnySalesAccess])

  // Realtime-triggered reload — unlike the mount/pathname/visibility
  // triggers below (which are fine reading a still-warm cache), a
  // `postgres_changes` event means something the dashboard displays
  // just changed (a deal dragged to a new stage, a goal edited), so the
  // very next fetch needs fresh numbers, not whatever the server cached
  // up to 3 minutes ago. Busts that cache first (best-effort — a failed
  // revalidate just means this one reload falls back to the stale
  // value, not a broken dashboard) and only then re-fetches.
  const reloadAfterRealtimeChange = useCallback(async () => {
    if (hasAnySalesAccess) {
      try {
        await fetch('/api/dashboard/ceo-summary/revalidate', { method: 'POST' })
      } catch (err) {
        console.error('[dashboard] ceo-summary revalidate failed:', err)
      }
    }
    loadAll()
  }, [hasAnySalesAccess, loadAll])

  // Coalesces a burst of realtime events (see the subscriptions below)
  // into one reload instead of one per row changed — a bulk import or
  // an automation touching many deals/contacts at once would otherwise
  // fire a full reload (plus a cache-bust round trip) per event, per
  // open tab.
  const debouncedLoadAll = useDebouncedCallback(reloadAfterRealtimeChange, 500, 2000)

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
        () => debouncedLoadAll(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'sales_goals', filter: `account_id=eq.${accountId}` },
        () => debouncedLoadAll(),
      )
      // Marking a stage won/lost in Pipeline settings retroactively
      // updates every deal already sitting there (migration 060), which
      // itself fires `deals` events the subscription above already
      // catches — but a stage with zero deals in it right now (e.g. a
      // brand-new "Perdidos" column) wouldn't touch a single `deals`
      // row, so the funnel's stage counts would stay stale until
      // something else reloads the page. Listening here directly closes
      // that gap.
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'pipeline_stages' },
        () => debouncedLoadAll(),
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [accountId, hasAnySalesAccess, debouncedLoadAll])

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
        () => debouncedLoadAll(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversations', filter: `account_id=eq.${accountId}` },
        () => debouncedLoadAll(),
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [accountId, debouncedLoadAll])

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

  // Global period switch — only refetches the widgets that actually
  // depend on it (Response Time, and the Sales section's metrics/goal
  // chart/top sellers), not the whole dashboard. See the
  // `periodRangeRef` note above for why `loadAll` itself can't be
  // reused here. Split into `applyPeriodRange` (the actual refetch,
  // given an already-resolved range) plus two thin event handlers so
  // picking a preset and editing a custom date both funnel through the
  // same fetch logic without double-fetching on mount — unlike an
  // effect keyed on `periodRange`, these only ever run in response to
  // an actual user interaction with the selector.
  const applyPeriodRange = useCallback(
    (r: PeriodRange, customRange?: { start: string; end: string }) => {
      const db = createClient()

      setResponseTimeLoading(true)
      loadResponseTime(db, r)
        .then((res) => setResponseTime(res))
        .catch((err) => console.error('[dashboard] response time failed:', err))
        .finally(() => setResponseTimeLoading(false))

      if (!hasAnySalesAccess) return

      // Same cached round trip loadAll uses — funnel/commercial/leadsByRep
      // come along too even though they're not range-dependent; they're
      // cheap (served from the same cache entry loadAll already primed)
      // and applying them here keeps this one call the single source of
      // truth for the whole sales section instead of two divergent paths.
      setCeoMetricsLoading(true)
      setSalesVsGoalLoading(true)
      setTopSellersLoading(true)
      setAlertsLoading(true)
      void fetchCeoSummary(r, STALE_DAYS, customRange)
        .then((data) => {
          setCeoMetrics(data.ceoMetrics)
          setSalesVsGoal(data.salesVsGoal)
          setFunnel(data.salesFunnel)
          setCommercial(data.commercialMetrics)
          setTopSellers(data.topSellers)
          setLeadsByRep(data.leadsByRep)
          setAlerts(data.alerts)
        })
        .catch((err) => console.error('[dashboard] ceo-summary failed:', err))
        .finally(() => {
          setCeoMetricsLoading(false)
          setSalesVsGoalLoading(false)
          setTopSellersLoading(false)
          setAlertsLoading(false)
        })
    },
    [hasAnySalesAccess],
  )

  const handlePresetChange = useCallback(
    (p: PeriodPreset) => {
      setPreset(p)
      // Custom needs both dates picked before there's a real range to
      // fetch — `handleCustomChange` below fires the fetch once they
      // are. Every other preset resolves immediately.
      if (p === 'custom') return
      applyPeriodRange(rangeForPreset(p))
    },
    [applyPeriodRange],
  )

  const handleCustomChange = useCallback(
    (start: string, end: string) => {
      setCustomStart(start)
      setCustomEnd(end)
      if (!start || !end) return
      applyPeriodRange(
        rangeForPreset('custom', { start: new Date(start), end: new Date(end) }),
        { start, end },
      )
    },
    [applyPeriodRange],
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
        <div className="flex flex-col items-start gap-1 sm:items-end">
          <PeriodSelector
            preset={preset}
            customStart={customStart}
            customEnd={customEnd}
            onPresetChange={handlePresetChange}
            onCustomChange={handleCustomChange}
          />
          <span className="text-xs text-muted-foreground">{periodRangeLabel}</span>
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

      {/* Team, HOT leads waiting on a reply, and today's AI qualification
          breakdown — three equal-width cards sharing the same header/list
          shape so the row reads as one deliberate set. The third slot
          used to be a generic "recent activity" changelog; it's the AI
          qualification summary now, since that's the product's actual
          flagship promise and deserves dashboard-level visibility, not
          just a badge in the Inbox. */}
      <RevealSection delayMs={200}>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="h-full">
            <TeamCard />
          </div>
          <div className="h-full">
            <HotUnansweredCard items={hotUnanswered} loading={hotUnansweredLoading} />
          </div>
          <div className="h-full">
            <LeadsQualifiedTodayCard data={leadsQualifiedToday} loading={leadsQualifiedTodayLoading} />
          </div>
        </div>
      </RevealSection>

      {/* Seguimiento — leads sitting in any pipeline's "Seguimiento" stage
          (is_followup_stage), grouped hot/warm/cold with direct management.
          Full width: it's a working queue, not a glance-and-move-on stat. */}
      <RevealSection delayMs={250}>
        <FollowupCard data={followup} loading={followupLoading} onLeadMoved={loadAll} />
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

          {/* Sales vs Goal + Commercial metrics — the trend line paired
              with the numbers that explain it (win rate, avg ticket,
              cycle length), instead of each sitting in its own
              full-width row. The chart keeps the wider 3/5 share; the
              stat list only ever needs enough room for three rows of
              text. */}
          {(sales.vsGoal || sales.commercial) && (
            <RevealSection delayMs={80}>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
                {sales.vsGoal && (
                  <div className={sales.commercial ? 'h-full lg:col-span-3' : 'h-full'}>
                    <SalesVsGoalChart data={salesVsGoal} loading={salesVsGoalLoading} currency={defaultCurrency} />
                  </div>
                )}
                {sales.commercial && (
                  <div className={sales.vsGoal ? 'h-full lg:col-span-2' : 'h-full'}>
                    <CommercialMetricsCard data={commercial} loading={commercialLoading} currency={defaultCurrency} />
                  </div>
                )}
              </div>
            </RevealSection>
          )}

          {sales.funnel && (
            <RevealSection delayMs={140}>
              <SalesFunnel data={funnel} loading={funnelLoading} currency={defaultCurrency} />
            </RevealSection>
          )}

          {/* Alerts + Top sellers — what needs attention paired with
              who's closing, an even 50/50 split since both are plain
              vertical lists with no chart geometry to favor either
              side. */}
          {(sales.alerts || sales.topSellers) && (
            <RevealSection delayMs={200}>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {sales.alerts && (
                  <div className="h-full">
                    <AlertsCard data={alerts} loading={alertsLoading} currency={defaultCurrency} staleDays={STALE_DAYS} />
                  </div>
                )}
                {sales.topSellers && (
                  <div className="h-full">
                    <TopSellersCard data={topSellers} loading={topSellersLoading} currency={defaultCurrency} />
                  </div>
                )}
              </div>
            </RevealSection>
          )}

          {sales.leadsByRep && (
            <RevealSection delayMs={220}>
              <LeadsByRepCard data={leadsByRep} loading={leadsByRepLoading} />
            </RevealSection>
          )}
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

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
