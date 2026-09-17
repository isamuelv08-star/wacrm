"use client"

import Link from 'next/link'
import { Clock, ListChecks, MessageCircleWarning } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { NextBestActionDisplay } from '@/lib/sales-intelligence/queries'
import type { NextBestActionUrgency } from '@/lib/sales-intelligence/next-best-action'
import { formatCurrency } from '@/lib/currency'
import { cn } from '@/lib/utils'
import { EmptyState } from './empty-state'
import { Skeleton } from './skeleton'

interface NextBestActionCardProps {
  items: NextBestActionDisplay[] | null
  loading: boolean
  currency: string
}

const URGENCY_STYLES: Record<NextBestActionUrgency, { row: string; badge: string }> = {
  high: { row: 'border-rose-500/25 bg-rose-500/[0.06] hover:border-rose-500/45 hover:bg-rose-500/10', badge: 'bg-rose-500/15 text-rose-400' },
  medium: { row: 'border-amber-400/25 bg-amber-400/[0.06] hover:border-amber-400/45 hover:bg-amber-400/10', badge: 'bg-amber-400/15 text-amber-500' },
  low: { row: 'border-border bg-muted/30 hover:bg-muted/50', badge: 'bg-muted text-muted-foreground' },
}

/**
 * "Estas son las cosas que debes hacer hoy" — the same stalled/at-risk
 * signals Money at Risk aggregates for a manager, turned into a short,
 * ranked, capped list of concrete actions: who to reach out to, why,
 * and how urgent. See next-best-action.ts's doc comment for why this
 * is account-wide rather than filtered to "assigned to me".
 */
export function NextBestActionCard({ items, loading, currency }: NextBestActionCardProps) {
  const t = useTranslations('Dashboard.nextBestAction')

  return (
    <section className="flex h-full flex-col rounded-xl border border-border bg-card">
      <header className="flex items-center justify-between border-b border-border px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{t('title')}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('description')}</p>
        </div>
        {items && items.length > 0 && (
          <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">
            {items.length}
          </span>
        )}
      </header>

      <div className="flex-1 p-3">
        {loading || !items ? (
          <div className="space-y-2 p-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="p-2">
            <EmptyState icon={ListChecks} title={t('allClear')} hint={t('allClearHint')} />
          </div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {items.map((it) => {
              const Icon = it.type === 're_engage_silent' ? MessageCircleWarning : Clock
              const style = URGENCY_STYLES[it.urgency]
              const label = it.contactName || it.contactPhone || t('unknownLead')
              const reason =
                it.type === 're_engage_silent'
                  ? t('reasonSilent', { days: it.daysInactive })
                  : t('reasonStalled', { days: it.daysInactive })

              const content = (
                <>
                  <span className={cn('flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full', style.badge)}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-medium text-foreground">{label}</span>
                      {it.assigneeName && (
                        <span className="shrink-0 truncate text-[11px] text-muted-foreground">· {it.assigneeName}</span>
                      )}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">{reason}</span>
                  </span>
                  {it.value != null && it.value > 0 && (
                    <span className="shrink-0 text-xs font-semibold tabular-nums text-foreground">
                      {formatCurrency(it.value, currency)}
                    </span>
                  )}
                </>
              )

              return (
                <li key={it.dealId}>
                  {it.conversationId ? (
                    <Link
                      href={`/inbox?c=${it.conversationId}`}
                      className={cn('flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors', style.row)}
                    >
                      {content}
                    </Link>
                  ) : (
                    <div className={cn('flex items-center gap-3 rounded-lg border px-3 py-2.5', style.row)}>{content}</div>
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
