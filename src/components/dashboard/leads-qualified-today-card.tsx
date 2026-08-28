"use client"

import type { LeadsQualifiedToday } from '@/lib/dashboard/types'
import { LEAD_SCORE_STYLES, type Score } from '@/components/leads/lead-score-badge'
import { cn } from '@/lib/utils'
import { Skeleton } from './skeleton'

import { useTranslations } from 'next-intl'

interface LeadsQualifiedTodayCardProps {
  data: LeadsQualifiedToday | null
  loading: boolean
}

// Hottest first — mirrors the Inbox's lead-score tab order.
const ROWS: Score[] = ['hot', 'warm', 'cold']

/**
 * Replaces the old "Recent activity" card in this same slot (third of
 * three equal cards alongside Team + HOT leads waiting). The flagship
 * promise of the product is AI qualification quality, so this is the
 * one dashboard card that puts that directly on screen: how many
 * leads the AI actually assessed today, broken down hot/warm/cold —
 * not a change-log of what happened, a read on what to do about it.
 */
export function LeadsQualifiedTodayCard({ data, loading }: LeadsQualifiedTodayCardProps) {
  const t = useTranslations('Dashboard.leadsQualifiedToday')
  const total = data ? data.hot + data.warm + data.cold : null

  return (
    <section className="flex h-full flex-col rounded-xl border border-border bg-card">
      <header className="flex items-center justify-between border-b border-border px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{t('title')}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {loading || total === null ? t('description') : t('totalToday', { count: total })}
          </p>
        </div>
      </header>

      <div className="flex-1 space-y-1.5 p-3">
        {loading || !data ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)
        ) : (
          ROWS.map((score) => {
            const { icon: Icon, className } = LEAD_SCORE_STYLES[score]
            return (
              <div key={score} className="flex items-center gap-3 rounded-lg px-2 py-2">
                <span
                  className={cn(
                    'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full',
                    className,
                  )}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {t(score, { count: data[score] })}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{t(`${score}Hint`)}</p>
                </div>
              </div>
            )
          })
        )}
      </div>
    </section>
  )
}
