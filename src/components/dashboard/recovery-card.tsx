"use client"

import Link from 'next/link'
import { Snowflake, Sparkles } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { RecoveryCandidate } from '@/lib/sales-intelligence/recovery'
import { formatCurrency } from '@/lib/currency'
import { EmptyState } from './empty-state'
import { Skeleton } from './skeleton'

interface RecoveryCardProps {
  items: RecoveryCandidate[] | null
  loading: boolean
  currency: string
}

/**
 * Recovery Center (fase 7) — cold leads worth a second look, never
 * every cold lead: each row here earned its place with a real signal
 * (a lost deal that had actual value, or a captured need) — see
 * loadRecoveryCandidates's own doc comment for why a bare "went cold"
 * lead never appears here.
 */
export function RecoveryCard({ items, loading, currency }: RecoveryCardProps) {
  const t = useTranslations('Dashboard.recovery')

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
            <EmptyState icon={Sparkles} title={t('empty')} hint={t('emptyHint')} />
          </div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {items.map((it) => {
              const label = it.contactName || it.contactPhone
              const reason = it.lostDealValue
                ? t('reasonLostDeal', { value: formatCurrency(it.lostDealValue, currency) })
                : t('reasonNeed', { need: it.need ?? '' })
              const content = (
                <>
                  <span
                    aria-hidden
                    className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-sky-500/15 text-sky-500"
                  >
                    <Snowflake className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">{label}</span>
                    <span className="block truncate text-xs text-muted-foreground">{reason}</span>
                  </span>
                </>
              )
              return (
                <li key={it.contactId}>
                  {it.conversationId ? (
                    <Link
                      href={`/inbox?c=${it.conversationId}`}
                      className="flex items-center gap-3 rounded-lg border border-sky-500/20 bg-sky-500/[0.05] px-3 py-2.5 transition-colors hover:border-sky-500/40 hover:bg-sky-500/10"
                    >
                      {content}
                    </Link>
                  ) : (
                    <div className="flex items-center gap-3 rounded-lg border border-sky-500/20 bg-sky-500/[0.05] px-3 py-2.5">
                      {content}
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
