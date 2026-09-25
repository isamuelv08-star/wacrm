'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { ArrowLeft, Handshake, Target, TrendingUp, Users2 } from 'lucide-react'
import { useAuth } from '@/hooks/use-auth'
import { formatCurrency } from '@/lib/currency'
import { MetricCard } from '@/components/dashboard/metric-card'
import { SkeletonCard } from '@/components/dashboard/skeleton'
import { InsightsPanel } from '@/components/dashboard/insights-panel'
import type { Insight } from '@/lib/sales-intelligence/insights'
import type { CeoMetrics, CommercialMetrics } from '@/lib/dashboard/ceo-types'
import { ceoSummaryRangeParams, rangeForPreset } from '@/lib/period'

// ============================================================
// "Ver informe completo" — the full-page counterpart to
// DailyReportDialog's popup summary. Same data, same InsightsPanel,
// no period selector (this is a snapshot, not an interactive
// dashboard — that's what /dashboard already is). Reuses
// GET /api/dashboard/ceo-summary as-is (default preset=thisMonth),
// so this page adds zero new queries: everything it shows was already
// being computed for /dashboard's own KPI row + Insights panel.
// ============================================================

interface ReportResponse {
  ceoMetrics: CeoMetrics | null
  commercialMetrics: CommercialMetrics | null
  insights: Insight[] | null
}

export default function DailyReportPage() {
  const t = useTranslations('Dashboard.report')
  const tDaily = useTranslations('Dashboard.dailyReport')
  const router = useRouter()
  const { defaultCurrency, canViewDashboardSection, loading: authLoading } = useAuth()

  const [data, setData] = useState<ReportResponse | null>(null)
  const [loading, setLoading] = useState(true)

  const hasAccess = canViewDashboardSection('dailyInsights')

  useEffect(() => {
    if (authLoading) return
    if (!hasAccess) {
      router.replace('/dashboard')
      return
    }
    let cancelled = false
    fetch(`/api/dashboard/ceo-summary?${ceoSummaryRangeParams(rangeForPreset('thisMonth')).toString()}`)
      .then((res) => {
        if (!res.ok) throw new Error(`ceo-summary request failed: ${res.status}`)
        return res.json() as Promise<ReportResponse>
      })
      .then((json) => {
        if (!cancelled) setData(json)
      })
      .catch((err) => console.error('[dashboard/informe] load failed:', err))
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [authLoading, hasAccess, router])

  if (!hasAccess) return null

  const ceoMetrics = data?.ceoMetrics ?? null
  const commercialMetrics = data?.commercialMetrics ?? null

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        {t('back')}
      </Link>

      <div>
        <p className="text-sm text-muted-foreground">{tDaily('greeting')}</p>
        <h1 className="mt-1 text-2xl font-semibold text-foreground">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{tDaily('subtitle')}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {loading || !ceoMetrics ? (
          Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <MetricCard
              title={tDaily('kpiSales')}
              value={formatCurrency(ceoMetrics.salesThisMonth.current, defaultCurrency)}
              icon={TrendingUp}
              tint="green"
            />
            <MetricCard
              title={tDaily('kpiLeads')}
              value={Math.round(ceoMetrics.newClients.current).toLocaleString()}
              icon={Users2}
              tint="blue"
            />
            <MetricCard
              title={tDaily('kpiOpportunities')}
              value={formatCurrency(ceoMetrics.pipelineTotal, defaultCurrency)}
              icon={Handshake}
              tint="purple"
            />
            <MetricCard
              title={tDaily('kpiConversion')}
              value={commercialMetrics?.winRatePct != null ? `${commercialMetrics.winRatePct.toFixed(0)}%` : '—'}
              icon={Target}
              tint="amber"
            />
          </>
        )}
      </div>

      <InsightsPanel insights={data?.insights ?? null} loading={loading} currency={defaultCurrency} />
    </div>
  )
}
