"use client"

import { Percent, DollarSign, CalendarClock } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { CommercialMetrics } from '@/lib/dashboard/ceo-types'
import { formatCurrency } from '@/lib/currency'
import { Skeleton } from '../skeleton'

interface CommercialMetricsCardProps {
  data: CommercialMetrics | null
  loading: boolean
  currency: string
}

export function CommercialMetricsCard({ data, loading, currency }: CommercialMetricsCardProps) {
  const t = useTranslations('Dashboard.ceo.commercial')

  return (
    <section className="flex h-full flex-col rounded-xl border border-border bg-card">
      <header className="border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold text-foreground">{t('title')}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{t('description')}</p>
      </header>

      {/* content-center: when this card sits next to a taller sibling
          (Sales vs Goal's chart) and the grid stretches it to match,
          the three stat rows distribute the extra height evenly above
          and below instead of clumping at the top with dead space
          under them. */}
      <div className="grid flex-1 content-center grid-cols-1 gap-3 p-5">
        {loading || !data ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)
        ) : (
          <>
            <Stat
              icon={Percent}
              label={t('winRate')}
              value={data.winRatePct != null ? `${data.winRatePct.toFixed(0)}%` : '—'}
            />
            <Stat icon={DollarSign} label={t('avgTicket')} value={formatCurrency(data.avgTicket, currency)} />
            <Stat
              icon={CalendarClock}
              label={t('salesCycle')}
              value={data.avgSalesCycleDays != null ? t('days', { count: Math.round(data.avgSalesCycleDays) }) : '—'}
            />
          </>
        )}
      </div>
    </section>
  )
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Percent
  label: string
  value: string
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border bg-muted/40 px-4 py-3">
      <span className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon className="h-4 w-4 text-primary" />
        {label}
      </span>
      <span className="text-lg font-semibold tabular-nums text-foreground">{value}</span>
    </div>
  )
}
