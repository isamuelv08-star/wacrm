"use client"

import { useCallback, useEffect, useState } from 'react'
import { Users } from 'lucide-react'
import { usePresence } from '@/hooks/use-presence'
import { PresenceDot } from '@/components/presence/presence-dot'
import { cn } from '@/lib/utils'
import { EmptyState } from './empty-state'
import { Skeleton } from './skeleton'
import type { AccountMember } from '@/types'

import { useTranslations } from 'next-intl'

/**
 * Team roster with live Active / Inactive status. "Active" collapses
 * the presence system's online + away into one state — this card is
 * a quick "who's around" glance, not the detailed roster (that's
 * Settings → Team, which already shows the finer online/away/offline
 * split via the same `usePresence` hook).
 */
export function TeamCard() {
  const t = useTranslations('Dashboard.team')
  const { getPresence } = usePresence()
  const [members, setMembers] = useState<AccountMember[] | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/account/members', { cache: 'no-store' })
      if (!res.ok) return
      const data = (await res.json()) as { members: AccountMember[] }
      setMembers(data.members)
    } catch (err) {
      console.error('[dashboard] team members failed:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void load()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [load])

  const activeCount = members?.filter((m) => getPresence(m.user_id) !== 'offline').length ?? 0

  return (
    <section className="flex h-full flex-col rounded-xl border border-border bg-card">
      <header className="flex items-center justify-between border-b border-border px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{t('title')}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t('activeCount', { count: activeCount })}
          </p>
        </div>
      </header>

      <div className="flex-1 p-3">
        {loading || !members ? (
          <div className="space-y-2 p-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-11 w-full" />
            ))}
          </div>
        ) : members.length === 0 ? (
          <div className="p-2">
            <EmptyState icon={Users} title={t('noMembers')} />
          </div>
        ) : (
          <ul className="flex flex-col gap-1">
            {members.map((m) => {
              const status = getPresence(m.user_id)
              const active = status !== 'offline'
              return (
                <li
                  key={m.user_id}
                  className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-muted/50"
                >
                  <span className="relative flex-shrink-0">
                    {m.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={m.avatar_url}
                        alt=""
                        className="h-8 w-8 rounded-full object-cover"
                      />
                    ) : (
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
                        {(m.full_name || m.email || 'U').charAt(0).toUpperCase()}
                      </span>
                    )}
                    <PresenceDot
                      status={status}
                      className="absolute -bottom-0.5 -right-0.5 ring-2 ring-card"
                    />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                    {m.full_name || t('unnamed')}
                  </span>
                  <span
                    className={cn(
                      'flex-shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium',
                      active
                        ? 'bg-emerald-500/12 text-emerald-500'
                        : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {active ? t('active') : t('inactive')}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}
