"use client"

import { Filter } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { FunnelStep } from '@/lib/dashboard/ceo-types'
import { formatCurrency } from '@/lib/currency'
import { EmptyState } from '../empty-state'
import { Skeleton } from '../skeleton'

interface SalesFunnelProps {
  data: FunnelStep[] | null
  loading: boolean
  currency: string
}

export function SalesFunnel({ data, loading, currency }: SalesFunnelProps) {
  const t = useTranslations('Dashboard.ceo.funnel')
  const hasData = (data ?? []).some((s) => s.count > 0)

  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold text-foreground">{t('title')}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{t('description')}</p>
      </header>

      <div className="p-5">
        {loading || !data ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : !hasData ? (
          <EmptyState icon={Filter} title={t('noData')} hint={t('noDataHint')} />
        ) : (
          <FunnelBars data={data} currency={currency} />
        )}
      </div>
    </section>
  )
}

function FunnelBars({ data, currency }: { data: FunnelStep[]; currency: string }) {
  const t = useTranslations('Dashboard.ceo.funnel')
  const maxCount = Math.max(1, ...data.map((s) => s.count))

  return (
    <div className="flex flex-col gap-2.5">
      {data.map((step, i) => {
        const prev = i > 0 ? data[i - 1] : null
        // % of the immediately preceding step that made it here — the
        // "where does it break" signal. The first row (Leads) has
        // nothing before it to convert from.
        const conversionPct = prev && prev.count > 0 ? (step.count / prev.count) * 100 : null
        const barWidth = Math.max(4, (step.count / maxCount) * 100)
        const label = step.key === 'leads' ? t('leads') : step.key === 'won' ? t('won') : step.label

        return (
          <div key={step.key} className="flex items-center gap-3">
            <span className="w-28 shrink-0 truncate text-xs text-muted-foreground" title={label}>
              {label}
            </span>
            <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted/40">
              <div
                className="h-full rounded-full bg-gradient-to-r from-primary/70 to-primary transition-all"
                style={{ width: `${barWidth}%` }}
              />
            </div>
            <span className="w-16 shrink-0 text-right text-xs font-semibold tabular-nums text-foreground">
              {step.count.toLocaleString()}
            </span>
            <span className="w-24 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
              {step.value != null ? formatCurrency(step.value, currency) : ''}
            </span>
            <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
              {conversionPct != null ? `${conversionPct.toFixed(0)}%` : ''}
            </span>
          </div>
        )
      })}
    </div>
  )
}
