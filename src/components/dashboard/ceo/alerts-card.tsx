"use client"

import { AlertTriangle, TrendingDown, UserX, GitBranch, ShieldCheck } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { CeoAlerts } from '@/lib/dashboard/ceo-types'
import { formatCurrency } from '@/lib/currency'
import { Skeleton } from '../skeleton'

interface AlertsCardProps {
  data: CeoAlerts | null
  loading: boolean
  currency: string
  staleDays: number
}

const ICONS = {
  stalled: AlertTriangle,
  stalledValue: AlertTriangle,
  atRisk: UserX,
  forecastGap: TrendingDown,
  winRate: TrendingDown,
  salesCycle: TrendingDown,
  pipelineCoverage: GitBranch,
} as const

export function AlertsCard({ data, loading, currency, staleDays }: AlertsCardProps) {
  const t = useTranslations('Dashboard.ceo.alerts')

  const rows = data
    ? [
        data.stalledCount > 0
          ? { key: 'stalled' as const, text: t('stalledCount', { count: data.stalledCount, days: staleDays }) }
          : null,
        data.stalledValue > 0
          ? { key: 'stalledValue' as const, text: t('stalledValue', { value: formatCurrency(data.stalledValue, currency) }) }
          : null,
        data.atRiskCustomerCount > 0
          ? { key: 'atRisk' as const, text: t('atRiskCustomers', { count: data.atRiskCustomerCount }) }
          : null,
        data.forecastGapPct != null
          ? { key: 'forecastGap' as const, text: t('forecastGap', { pct: Math.abs(data.forecastGapPct).toFixed(0) }) }
          : null,
        data.winRateDeclinePts != null
          ? { key: 'winRate' as const, text: t('winRateDeclined', { pts: data.winRateDeclinePts.toFixed(0) }) }
          : null,
        data.salesCycleIncreasePct != null
          ? { key: 'salesCycle' as const, text: t('salesCycleIncreased', { pct: data.salesCycleIncreasePct.toFixed(0) }) }
          : null,
        data.lowPipelineCoverage != null
          ? { key: 'pipelineCoverage' as const, text: t('lowPipelineCoverage', { multiple: data.lowPipelineCoverage.toFixed(1) }) }
          : null,
      ].filter((r): r is { key: keyof typeof ICONS; text: string } => r !== null)
    : []

  return (
    <section className="flex h-full flex-col rounded-xl border border-border bg-card">
      <header className="flex items-center gap-2 border-b border-border px-5 py-4">
        <AlertTriangle className="h-4 w-4 text-rose-400" />
        <h2 className="text-sm font-semibold text-foreground">{t('title')}</h2>
      </header>

      <div className="flex-1 p-4">
        {loading || !data ? (
          <div className="space-y-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 py-6 text-center">
            <ShieldCheck className="h-8 w-8 text-emerald-500" />
            <p className="text-sm font-medium text-foreground">{t('allGood')}</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {rows.map((row) => {
              const Icon = ICONS[row.key]
              return (
                <li
                  key={row.key}
                  className="flex items-center gap-2.5 rounded-lg border border-rose-500/25 bg-rose-500/[0.07] px-3 py-2.5 text-sm text-rose-300"
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {row.text}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}
