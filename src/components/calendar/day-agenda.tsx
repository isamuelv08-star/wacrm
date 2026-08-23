'use client'

import { useState } from 'react'
import { format } from 'date-fns'
import { useTranslations } from 'next-intl'
import {
  Briefcase,
  Check,
  ClipboardList,
  Phone,
  Plus,
  RotateCcw,
  Trash2,
  Users,
  X,
} from 'lucide-react'
import type { CalendarEvent, CalendarEventType } from '@/types'
import { cn } from '@/lib/utils'
import { EVENT_TYPE_COLOR } from './month-grid'

const EVENT_TYPE_ICON: Record<CalendarEventType, typeof Phone> = {
  call: Phone,
  meeting: Users,
  follow_up: ClipboardList,
  task: Briefcase,
  other: ClipboardList,
}

interface DayAgendaProps {
  date: Date
  events: CalendarEvent[]
  loading: boolean
  /** RLS requires agent+ to write calendar_events — hides every
   *  create/complete/reopen/cancel/delete affordance for a viewer
   *  instead of leaving clickable actions that would just fail. */
  canWrite: boolean
  onNew: () => void
  onEdit: (event: CalendarEvent) => void
  onComplete: (event: CalendarEvent) => void
  onReopen: (event: CalendarEvent) => void
  onCancel: (event: CalendarEvent) => void
  onDelete: (event: CalendarEvent) => void
}

export function DayAgenda({
  date,
  events,
  loading,
  canWrite,
  onNew,
  onEdit,
  onComplete,
  onReopen,
  onCancel,
  onDelete,
}: DayAgendaProps) {
  const t = useTranslations('Calendar')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const sorted = [...events].sort(
    (a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime(),
  )

  return (
    <section className="flex h-full flex-col rounded-xl border border-border bg-card">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold text-foreground capitalize">
          {date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
        </h3>
        {canWrite && (
          <button
            type="button"
            onClick={onNew}
            className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground transition-colors hover:bg-primary/90"
            aria-label={t('newEvent')}
          >
            <Plus className="h-4 w-4" />
          </button>
        )}
      </header>

      <div className="flex-1 overflow-y-auto p-3">
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="h-14 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        ) : sorted.length === 0 ? (
          <div className="flex h-full min-h-32 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border px-4 py-6 text-center">
            <p className="text-sm text-muted-foreground">{t('noEventsThisDay')}</p>
            {canWrite && (
              <button
                type="button"
                onClick={onNew}
                className="text-xs font-medium text-primary hover:underline"
              >
                {t('scheduleOne')}
              </button>
            )}
          </div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {sorted.map((ev) => {
              const Icon = EVENT_TYPE_ICON[ev.type]
              const isDone = ev.status !== 'pending'
              return (
                <li
                  key={ev.id}
                  className={cn(
                    'group rounded-lg border border-border px-3 py-2.5 transition-colors',
                    isDone ? 'bg-muted/30' : 'bg-card hover:border-primary/40',
                  )}
                >
                  <div className="flex items-start gap-2.5">
                    <span
                      aria-hidden
                      className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
                      style={{
                        background: `${EVENT_TYPE_COLOR[ev.type]}26`,
                        color: EVENT_TYPE_COLOR[ev.type],
                      }}
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <button
                      type="button"
                      onClick={() => onEdit(ev)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <p
                        className={cn(
                          'truncate text-sm font-medium text-foreground',
                          ev.status === 'cancelled' && 'line-through opacity-60',
                        )}
                      >
                        {ev.title}
                      </p>
                      <p className="text-xs text-muted-foreground tabular-nums">
                        {format(new Date(ev.starts_at), 'HH:mm')}
                        {ev.contact && ` · ${ev.contact.name || ev.contact.phone}`}
                      </p>
                    </button>
                    {canWrite && (confirmDeleteId === ev.id ? (
                      <div className="flex shrink-0 items-center gap-1 rounded-md border border-red-500/30 bg-red-500/10 px-1.5 py-1">
                        <span className="text-[11px] text-red-300">{t('deletePrompt')}</span>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="rounded px-1 text-[11px] text-muted-foreground hover:bg-muted"
                        >
                          {t('cancel')}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setConfirmDeleteId(null)
                            onDelete(ev)
                          }}
                          className="rounded bg-red-600 px-1.5 py-0.5 text-[11px] font-medium text-white hover:bg-red-700"
                        >
                          {t('confirm')}
                        </button>
                      </div>
                    ) : (
                      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        {ev.status === 'pending' ? (
                          <button
                            type="button"
                            onClick={() => onComplete(ev)}
                            className="rounded p-1 text-muted-foreground hover:bg-emerald-500/10 hover:text-emerald-400"
                            aria-label={t('markComplete')}
                          >
                            <Check className="h-3.5 w-3.5" />
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => onReopen(ev)}
                            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                            aria-label={t('reopen')}
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {ev.status === 'pending' && (
                          <button
                            type="button"
                            onClick={() => onCancel(ev)}
                            className="rounded p-1 text-muted-foreground hover:bg-amber-500/10 hover:text-amber-400"
                            aria-label={t('cancelEvent')}
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(ev.id)}
                          className="rounded p-1 text-muted-foreground hover:bg-red-500/10 hover:text-red-400"
                          aria-label={t('deleteEvent')}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}
