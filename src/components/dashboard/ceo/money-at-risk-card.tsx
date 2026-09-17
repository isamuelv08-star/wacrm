"use client"

import { ShieldCheck, Wallet } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { MoneyAtRiskData } from '@/lib/sales-intelligence/aggregate'
import { formatCurrency, formatCurrencyShort } from '@/lib/currency'
import { Skeleton } from '../skeleton'

interface MoneyAtRiskCardProps {
  data: MoneyAtRiskData | null
  loading: boolean
  currency: string
  staleDays: number
}

/**
 * "Dónde se escapa el valor" — breaks the same stalled-deal total the
 * Alerts card already shows as one line (`stalledValue`) down by
 * seller and by pipeline stage, so a manager can see who/where needs
 * attention without opening every deal. See
 * src/lib/sales-intelligence/queries.ts for why this always agrees
 * with the Alerts card's number instead of recomputing it.
 */
export function MoneyAtRiskCard({ data, loading, currency, staleDays }: MoneyAtRiskCardProps) {
  const t = useTranslations('Dashboard.ceo.moneyAtRisk')

  return (
    <section className="flex h-full flex-col rounded-xl border border-border bg-card">
      <header className="flex items-center justify-between gap-2 border-b border-border px-5 py-4">
        <div className="flex items-center gap-2">
          <Wallet className="h-4 w-4 text-amber-400" />
          <div>
            <h2 className="text-sm font-semibold text-foreground">{t('title')}</h2>
            <p className="text-xs text-muted-foreground">{t('subtitle', { days: staleDays })}</p>
          </div>
        </div>
        {!loading && data && data.totalCount > 0 && (
          <span className="shrink-0 text-lg font-semibold tabular-nums text-amber-400">
            {formatCurrencyShort(data.totalValue, currency)}
          </span>
        )}
      </header>

      <div className="flex-1 p-4">
        {loading || !data ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          </div>
        ) : data.totalCount === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 py-6 text-center">
            <ShieldCheck className="h-8 w-8 text-emerald-500" />
            <p className="text-sm font-medium text-foreground">{t('empty')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Breakdown
              title={t('bySeller')}
              rows={data.bySeller}
              totalValue={data.totalValue}
              currency={currency}
              fallbackLabel={t('unassigned')}
              t={t}
            />
            <Breakdown
              title={t('byStage')}
              rows={data.byStage}
              totalValue={data.totalValue}
              currency={currency}
              fallbackLabel={t('unknownStage')}
              t={t}
            />
          </div>
        )}
      </div>
    </section>
  )
}

function Breakdown({
  title,
  rows,
  totalValue,
  currency,
  fallbackLabel,
  t,
}: {
  title: string
  rows: MoneyAtRiskData['bySeller']
  totalValue: number
  currency: string
  fallbackLabel: string
  t: ReturnType<typeof useTranslations>
}) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <ul className="flex flex-col gap-2">
        {rows.map((row) => {
          const share = totalValue > 0 ? Math.min(100, Math.max(4, (row.value / totalValue) * 100)) : 0
          return (
            <li key={row.key} className="rounded-lg border border-border bg-muted/30 px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-medium text-foreground">
                  {row.label ?? fallbackLabel}
                </span>
                <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
                  {formatCurrency(row.value, currency)}
                </span>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-amber-400 transition-all" style={{ width: `${share}%` }} />
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">{t('dealsCount', { count: row.count })}</span>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
