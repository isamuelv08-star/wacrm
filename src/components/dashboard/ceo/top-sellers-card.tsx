"use client"

import { Trophy } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { TopSeller } from '@/lib/dashboard/ceo-types'
import { formatCurrencyShort } from '@/lib/currency'
import { cn } from '@/lib/utils'
import { EmptyState } from '../empty-state'
import { Skeleton } from '../skeleton'

interface TopSellersCardProps {
  data: TopSeller[] | null
  loading: boolean
  currency: string
}

/** Quota-attainment color band — at a glance, who's on track vs. who
 *  needs a conversation, not just a ranked list of numbers. */
function attainmentTier(pct: number): { text: string; bar: string } {
  if (pct >= 100) return { text: 'text-emerald-500', bar: 'bg-emerald-500' }
  if (pct >= 80) return { text: 'text-amber-400', bar: 'bg-amber-400' }
  if (pct >= 60) return { text: 'text-orange-400', bar: 'bg-orange-400' }
  return { text: 'text-rose-400', bar: 'bg-rose-400' }
}

export function TopSellersCard({ data, loading, currency }: TopSellersCardProps) {
  const t = useTranslations('Dashboard.ceo.topSellers')

  return (
    <section className="flex h-full flex-col rounded-xl border border-border bg-card">
      <header className="border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold text-foreground">{t('title')}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{t('description')}</p>
      </header>

      <div className="flex-1 p-3">
        {loading || !data ? (
          <div className="space-y-2 p-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : data.length === 0 ? (
          <div className="p-2">
            <EmptyState icon={Trophy} title={t('noData')} hint={t('noDataHint')} />
          </div>
        ) : (
          <ul className="flex flex-col gap-2 p-2">
            {data.map((seller, i) => {
              const pct = seller.attainmentPct
              const barWidth = pct != null ? Math.min(100, Math.max(4, pct)) : 0
              const tier = pct != null ? attainmentTier(pct) : null
              return (
                <li key={seller.userId} className="rounded-lg border border-border bg-muted/30 px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="w-4 shrink-0 text-xs font-semibold text-muted-foreground tabular-nums">
                        {i + 1}
                      </span>
                      <span className="truncate text-sm font-medium text-foreground">{seller.name}</span>
                    </span>
                    <span
                      className={cn('shrink-0 text-sm font-semibold tabular-nums', tier ? tier.text : 'text-foreground')}
                    >
                      {pct != null ? `${pct.toFixed(0)}%` : formatCurrencyShort(seller.soldThisMonth, currency)}
                    </span>
                  </div>
                  {pct != null && tier && (
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn('h-full rounded-full transition-all', tier.bar)}
                        style={{ width: `${barWidth}%` }}
                      />
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}
