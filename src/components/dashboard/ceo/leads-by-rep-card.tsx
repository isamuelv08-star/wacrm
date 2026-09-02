"use client"

import { Users, MessageCircle, Handshake } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { LeadsByRep } from '@/lib/dashboard/ceo-types'
import { EmptyState } from '../empty-state'
import { Skeleton } from '../skeleton'

interface LeadsByRepCardProps {
  data: LeadsByRep[] | null
  loading: boolean
}

/** Same "who owns what right now" spirit as `TopSellersCard`, but a
 *  live count of currently-assigned leads (open conversations + open
 *  deals) rather than a $ ranking for a period — this is what makes
 *  the equitable AI distribution (migration 069) and manual/first-
 *  touch assignment visible to the manager without opening the inbox
 *  or pipeline. */
export function LeadsByRepCard({ data, loading }: LeadsByRepCardProps) {
  const t = useTranslations('Dashboard.ceo.leadsByRep')

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
            <EmptyState icon={Users} title={t('noData')} hint={t('noDataHint')} />
          </div>
        ) : (
          <ul className="flex flex-col gap-2 p-2">
            {data.map((rep) => (
              <li key={rep.userId} className="rounded-lg border border-border bg-muted/30 px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-foreground">{rep.name}</span>
                  <span className="flex shrink-0 items-center gap-3 text-xs font-semibold tabular-nums text-muted-foreground">
                    <span className="flex items-center gap-1" title={t('conversationsTitle')}>
                      <MessageCircle className="h-3 w-3" />
                      {rep.assignedConversations}
                    </span>
                    <span className="flex items-center gap-1" title={t('dealsTitle')}>
                      <Handshake className="h-3 w-3" />
                      {rep.assignedDeals}
                    </span>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
