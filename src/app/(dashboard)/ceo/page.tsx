"use client"

import { useCallback, useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Crown, Handshake, Target, TrendingUp, Users2 } from 'lucide-react'

import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-auth'
import { formatCurrency } from '@/lib/currency'

import {
  loadCeoAlerts,
  loadCeoMetrics,
  loadCommercialMetrics,
  loadSalesVsGoal,
  loadTopSellers,
} from '@/lib/dashboard/ceo-queries'
import { loadPipelineDonut } from '@/lib/dashboard/queries'
import type {
  CeoAlerts,
  CeoMetrics,
  CommercialMetrics,
  SalesVsGoalPoint,
  TopSeller,
} from '@/lib/dashboard/ceo-types'
import type { PipelineDonutData } from '@/lib/dashboard/types'

import { MetricCard } from '@/components/dashboard/metric-card'
import { SkeletonCard } from '@/components/dashboard/skeleton'
import { PipelineDonut } from '@/components/dashboard/pipeline-donut'
import { SalesVsGoalChart } from '@/components/dashboard/ceo/sales-vs-goal-chart'
import { CommercialMetricsCard } from '@/components/dashboard/ceo/commercial-metrics-card'
import { TopSellersCard } from '@/components/dashboard/ceo/top-sellers-card'
import { AlertsCard } from '@/components/dashboard/ceo/alerts-card'

// Deals sitting untouched this long count as "stalled" in the Alerts
// card — matches what the user asked for when this page was scoped.
const STALE_DAYS = 7

export default function CeoDashboardPage() {
  const t = useTranslations('Dashboard.ceo.page')
  const router = useRouter()
  const pathname = usePathname()
  const { accountId, isOwner, profileLoading, defaultCurrency } = useAuth()

  // Sensitive (revenue, quotas, per-rep ranking) — owner only. The
  // sidebar already hides this link from everyone else, but a direct
  // URL visit still needs its own gate. Bounce to the regular
  // dashboard rather than showing an empty/broken page.
  useEffect(() => {
    if (!profileLoading && !isOwner) {
      router.replace('/dashboard')
    }
  }, [profileLoading, isOwner, router])

  const [metrics, setMetrics] = useState<CeoMetrics | null>(null)
  const [metricsLoading, setMetricsLoading] = useState(true)

  const [salesVsGoal, setSalesVsGoal] = useState<SalesVsGoalPoint[] | null>(null)
  const [salesVsGoalLoading, setSalesVsGoalLoading] = useState(true)

  const [pipeline, setPipeline] = useState<PipelineDonutData | null>(null)
  const [pipelineLoading, setPipelineLoading] = useState(true)

  const [commercial, setCommercial] = useState<CommercialMetrics | null>(null)
  const [commercialLoading, setCommercialLoading] = useState(true)

  const [topSellers, setTopSellers] = useState<TopSeller[] | null>(null)
  const [topSellersLoading, setTopSellersLoading] = useState(true)

  const [alerts, setAlerts] = useState<CeoAlerts | null>(null)
  const [alertsLoading, setAlertsLoading] = useState(true)

  const loadAll = useCallback(() => {
    const db = createClient()

    void loadCeoMetrics(db)
      .then((m) => {
        setMetrics(m)
        // Alerts need the forecast + goal this same call already
        // computed — fetch it right after instead of re-scanning
        // open deals a second time.
        setAlertsLoading(true)
        void loadCeoAlerts(db, m.forecast, m.goalThisMonth, STALE_DAYS)
          .then((a) => setAlerts(a))
          .catch((err) => console.error('[ceo-dashboard] alerts failed:', err))
          .finally(() => setAlertsLoading(false))
      })
      .catch((err) => console.error('[ceo-dashboard] metrics failed:', err))
      .finally(() => setMetricsLoading(false))

    void loadSalesVsGoal(db, 6)
      .then((s) => setSalesVsGoal(s))
      .catch((err) => console.error('[ceo-dashboard] sales-vs-goal failed:', err))
      .finally(() => setSalesVsGoalLoading(false))

    void loadPipelineDonut(db)
      .then((p) => setPipeline(p))
      .catch((err) => console.error('[ceo-dashboard] pipeline failed:', err))
      .finally(() => setPipelineLoading(false))

    void loadCommercialMetrics(db)
      .then((c) => setCommercial(c))
      .catch((err) => console.error('[ceo-dashboard] commercial failed:', err))
      .finally(() => setCommercialLoading(false))

    void loadTopSellers(db)
      .then((s) => setTopSellers(s))
      .catch((err) => console.error('[ceo-dashboard] top-sellers failed:', err))
      .finally(() => setTopSellersLoading(false))
  }, [])

  // Same staleness fix as /dashboard: refetch on every landing on this
  // route (not just first mount) and on regaining tab visibility.
  useEffect(() => {
    if (pathname === '/ceo' && isOwner) loadAll()
  }, [pathname, isOwner, loadAll])

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && isOwner) loadAll()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [loadAll, isOwner])

  // Live updates — a deal closing or a goal being edited anywhere in
  // the app should reflect here without a manual refresh. Same
  // `postgres_changes` + account-scoped filter pattern as
  // usePresence/message-thread; the payload isn't used directly, it
  // just triggers a full reload since so many KPIs derive from the
  // same underlying deal rows.
  useEffect(() => {
    if (!accountId || !isOwner) return
    const supabase = createClient()
    const channel = supabase
      .channel(`ceo-dashboard:${accountId}`)
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
  }, [accountId, isOwner, loadAll])

  if (profileLoading || !isOwner) return null

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Crown className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('title')}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{t('description')}</p>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {metricsLoading || !metrics ? (
          Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <MetricCard
              title={t('sales')}
              value={formatCurrency(metrics.salesThisMonth.current, defaultCurrency)}
              icon={TrendingUp}
              tint="green"
              delta={{
                sign: metrics.salesThisMonth.current - metrics.salesThisMonth.previous,
                label: deltaLabel(metrics.salesThisMonth.current - metrics.salesThisMonth.previous, defaultCurrency, t),
              }}
            />
            <MetricCard
              title={t('goal')}
              value={metrics.goalThisMonth != null ? formatCurrency(metrics.goalThisMonth, defaultCurrency) : '—'}
              icon={Target}
              tint="blue"
              subtitle={
                metrics.goalAttainmentPct != null
                  ? t('goalAttainment', { pct: metrics.goalAttainmentPct.toFixed(1) })
                  : t('goalNotSet')
              }
            />
            <MetricCard
              title={t('pipeline')}
              value={formatCurrency(metrics.pipelineTotal, defaultCurrency)}
              icon={Handshake}
              tint="purple"
              subtitle={
                metrics.pipelineCoverage != null
                  ? t('pipelineCoverage', { multiple: metrics.pipelineCoverage.toFixed(1) })
                  : undefined
              }
            />
            <MetricCard
              title={t('forecast')}
              value={formatCurrency(metrics.forecast, defaultCurrency)}
              icon={TrendingUp}
              tint="amber"
              subtitle={metrics.forecastPct != null ? t('forecastOfGoal', { pct: metrics.forecastPct.toFixed(0) }) : undefined}
            />
            <MetricCard
              title={t('clients')}
              value={metrics.totalClients.toLocaleString()}
              icon={Users2}
              tint="teal"
              delta={{
                sign: metrics.newClients.current - metrics.newClients.previous,
                label: deltaCountLabel(metrics.newClients.current - metrics.newClients.previous, t),
              }}
            />
          </>
        )}
      </div>

      {/* Sales vs goal + pipeline */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <div className="h-full lg:col-span-3">
          <SalesVsGoalChart data={salesVsGoal} loading={salesVsGoalLoading} currency={defaultCurrency} />
        </div>
        <div className="h-full lg:col-span-2">
          <PipelineDonut data={pipeline} loading={pipelineLoading} currency={defaultCurrency} />
        </div>
      </div>

      {/* Commercial metrics + alerts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <div className="h-full lg:col-span-2">
          <CommercialMetricsCard data={commercial} loading={commercialLoading} currency={defaultCurrency} />
        </div>
        <div className="h-full lg:col-span-3">
          <AlertsCard data={alerts} loading={alertsLoading} currency={defaultCurrency} staleDays={STALE_DAYS} />
        </div>
      </div>

      {/* Top sellers */}
      <TopSellersCard data={topSellers} loading={topSellersLoading} currency={defaultCurrency} />
    </div>
  )
}

// ------------------------------------------------------------

function deltaLabel(
  delta: number,
  currency: string,
  t: ReturnType<typeof useTranslations>,
): string {
  if (delta === 0) return t('noChangeVsLastMonth')
  const sign = delta > 0 ? '+' : ''
  return `${sign}${formatCurrency(delta, currency)} ${t('vsLastMonth')}`
}

function deltaCountLabel(delta: number, t: ReturnType<typeof useTranslations>): string {
  if (delta === 0) return t('noChangeVsLastMonth')
  const sign = delta > 0 ? '+' : ''
  return `${sign}${delta.toLocaleString()} ${t('vsLastMonth')}`
}
