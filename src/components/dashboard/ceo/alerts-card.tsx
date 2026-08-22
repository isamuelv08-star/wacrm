"use client"

import { AlertTriangle, TrendingDown, ShieldCheck } from 'lucide-react'
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

export function AlertsCard({ data, loading, currency, staleDays }: AlertsCardProps) {
  const t = useTranslations('Dashboard.ceo.alerts')

  const rows = data
    ? [
        data.stalledCount > 0
          ? { key: 'stalled', text: t('stalledCount', { count: data.stalledCount, days: staleDays }) }
          : null,
        data.stalledValue > 0
          ? { key: 'stalledValue', text: t('stalledValue', { value: formatCurrency(data.stalledValue, currency) }) }
          : null,
        data.forecastGapPct != null
          ? { key: 'forecastGap', text: t('forecastGap', { pct: Math.abs(data.forecastGapPct).toFixed(0) }) }
          : null,
      ].filter((r): r is { key: string; text: string } => r !== null)
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
            {rows.map((row) => (
              <li
                key={row.key}
                className="flex items-center gap-2.5 rounded-lg border border-rose-500/25 bg-rose-500/[0.07] px-3 py-2.5 text-sm text-rose-300"
              >
                {row.key === 'forecastGap' ? (
                  <TrendingDown className="h-4 w-4 shrink-0" />
                ) : (
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                )}
                {row.text}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
