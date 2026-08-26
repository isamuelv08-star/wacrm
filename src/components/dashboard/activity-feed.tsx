"use client"

import Link from 'next/link'
import { MessageSquare, UserPlus, Briefcase, Radio, Zap, Inbox } from 'lucide-react'
import type { ComponentType } from 'react'
import type { ActivityItem, ActivityKind } from '@/lib/dashboard/types'
import { cn } from '@/lib/utils'
import { EmptyState } from './empty-state'
import { Skeleton } from './skeleton'

import { useTranslations } from 'next-intl'

interface ActivityFeedProps {
  items: ActivityItem[] | null
  loading: boolean
}

interface KindTheme {
  icon: ComponentType<{ className?: string }>
  /** Tailwind classes for the round icon badge. */
  badge: string
}

const KIND_THEME: Record<ActivityKind, KindTheme> = {
  message: { icon: MessageSquare, badge: 'bg-blue-500/10 text-blue-400' },
  contact: { icon: UserPlus, badge: 'bg-primary/10 text-primary' },
  deal: { icon: Briefcase, badge: 'bg-primary/10 text-primary' },
  broadcast: { icon: Radio, badge: 'bg-amber-500/10 text-amber-400' },
  automation: { icon: Zap, badge: 'bg-rose-500/10 text-rose-400' },
}

/**
 * Compact "recent activity" card — sits alongside Team and HOT-leads-
 * waiting as the third card in that row, so it deliberately matches
 * their exact shape (header + a plain `ul` of hoverable rows, no
 * footer/pagination) rather than the wider, paginated full-width
 * layout this once had. The account already has three other places
 * to go deep on any one of these sources (Inbox, Contacts, Pipelines),
 * so this card's job is just "what changed recently, at a glance."
 */
export function ActivityFeed({ items, loading }: ActivityFeedProps) {
  const t = useTranslations('Dashboard.activityFeed')

  return (
    <section className="flex h-full flex-col rounded-xl border border-border bg-card">
      <header className="flex items-center justify-between border-b border-border px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{t('title')}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('description')}</p>
        </div>
      </header>

      <div className="flex-1 p-3">
        {loading || !items ? (
          <div className="space-y-2 p-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-11 w-full" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="p-2">
            <EmptyState icon={Inbox} title={t('noActivity')} hint={t('noActivityHint')} />
          </div>
        ) : (
          <ul className="flex flex-col gap-1">
            {items.map((it) => {
              const theme = KIND_THEME[it.kind]
              const Icon = theme.icon
              const content = (
                <>
                  <span
                    className={cn(
                      'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full',
                      theme.badge,
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                    {activityText(it, t)}
                  </span>
                  <span className="flex-shrink-0 text-xs text-muted-foreground tabular-nums">
                    {relativeTime(it.at, t)}
                  </span>
                </>
              )
              return (
                <li key={it.id}>
                  {it.href ? (
                    <Link
                      href={it.href}
                      className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-muted/50"
                    >
                      {content}
                    </Link>
                  ) : (
                    <div className="flex items-center gap-3 rounded-lg px-2 py-2">{content}</div>
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

function activityText(item: ActivityItem, t: ReturnType<typeof useTranslations>): string {
  switch (item.kind) {
    case 'message':
      return item.detail
        ? t('items.newMessage', { name: item.subject, snippet: item.detail })
        : t('items.newMessageNoText', { name: item.subject })
    case 'contact':
      return t('items.newContact', { name: item.subject })
    case 'deal':
      return t('items.newDeal', { title: item.subject, value: item.detail ?? '' })
    case 'broadcast':
      return t('items.newBroadcast', { name: item.subject })
    case 'automation':
      return item.detail
        ? t('items.automationRun', { name: item.subject, contact: item.detail })
        : t('items.automationRunNoContact', { name: item.subject })
  }
}

function relativeTime(iso: string, t: ReturnType<typeof useTranslations>): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const diffSec = Math.round((Date.now() - then) / 1000)
  if (diffSec < 60) return t('timeS', { sec: Math.max(1, diffSec) })
  if (diffSec < 3600) return t('timeM', { min: Math.floor(diffSec / 60) })
  if (diffSec < 86400) return t('timeH', { hr: Math.floor(diffSec / 3600) })
  if (diffSec < 2_592_000) return t('timeD', { day: Math.floor(diffSec / 86400) })
  return new Date(iso).toLocaleDateString()
}
