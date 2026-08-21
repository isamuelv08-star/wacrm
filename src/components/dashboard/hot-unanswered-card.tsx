"use client"

import Link from 'next/link'
import { Flame } from 'lucide-react'
import type { HotUnansweredItem } from '@/lib/dashboard/types'
import { EmptyState } from './empty-state'
import { Skeleton } from './skeleton'

import { useTranslations } from 'next-intl'

interface HotUnansweredCardProps {
  items: HotUnansweredItem[] | null
  loading: boolean
}

/**
 * "Juana +15m sin respuesta" — HOT-scored leads whose last message
 * (from the customer) has gone unanswered. Each row deep-links
 * straight into that conversation so picking one up is a single
 * click from the dashboard.
 */
export function HotUnansweredCard({ items, loading }: HotUnansweredCardProps) {
  const t = useTranslations('Dashboard.hotUnanswered')

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
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="p-2">
            <EmptyState icon={Flame} title={t('allCaughtUp')} hint={t('allCaughtUpHint')} />
          </div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {items.map((it) => (
              <li key={it.conversationId}>
                <Link
                  href={`/inbox?c=${it.conversationId}`}
                  className="group flex items-center gap-3 rounded-lg border border-rose-500/20 bg-rose-500/[0.06] px-3 py-2.5 transition-colors hover:border-rose-500/40 hover:bg-rose-500/10"
                >
                  <span
                    aria-hidden
                    className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-rose-500/15 text-rose-400"
                    style={{ animation: 'metric-glow-pulse 2.2s ease-in-out infinite' }}
                  >
                    <Flame className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                    {it.contactName}
                  </span>
                  <span className="flex-shrink-0 text-xs font-semibold text-rose-400 tabular-nums">
                    {t('waiting', { minutes: it.waitingMinutes })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
