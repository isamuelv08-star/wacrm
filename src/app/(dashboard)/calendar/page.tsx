'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { endOfMonth, endOfWeek, startOfMonth, startOfWeek } from 'date-fns'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-auth'
import { useCan } from '@/hooks/use-can'
import { completeEvent, loadEventsInRange, reopenEvent } from '@/lib/calendar/queries'
import type { CalendarEvent, Profile } from '@/types'
import { MonthGrid } from '@/components/calendar/month-grid'
import { DayAgenda } from '@/components/calendar/day-agenda'
import { EventFormDialog } from '@/components/calendar/event-form-dialog'

export default function CalendarPage() {
  const t = useTranslations('Calendar')
  const { accountId } = useAuth()
  // RLS requires agent+ to write calendar_events (viewers can only
  // read, same as deals/contacts) — gate the write affordances so a
  // viewer doesn't see clickable actions that silently fail with a
  // generic RLS error, matching pipelines/page.tsx's own
  // useCan("send-messages") gate on its "New Deal" button.
  const canWrite = useCan('send-messages')

  const [month, setMonth] = useState(() => new Date())
  const [selectedDate, setSelectedDate] = useState(() => new Date())
  const [events, setEvents] = useState<CalendarEvent[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [assigneeFilter, setAssigneeFilter] = useState('all')

  const [formOpen, setFormOpen] = useState(false)
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null)

  // Load the full visible grid range (not just the calendar month) so
  // the leading/trailing days borrowed from adjacent months still show
  // their event dots correctly.
  const gridStart = useMemo(() => startOfWeek(startOfMonth(month), { weekStartsOn: 1 }), [month])
  const gridEnd = useMemo(() => endOfWeek(endOfMonth(month), { weekStartsOn: 1 }), [month])

  const load = useCallback(() => {
    const db = createClient()
    setLoading(true)
    loadEventsInRange(db, gridStart, gridEnd)
      .then((rows) => setEvents(rows))
      .catch((err) => {
        console.error('[calendar] load failed:', err)
        toast.error(t('toastLoadFailed'))
      })
      .finally(() => setLoading(false))
  }, [gridStart, gridEnd, t])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    const db = createClient()
    db.from('profiles')
      .select('*')
      .order('full_name')
      .then(({ data }) => setProfiles((data ?? []) as Profile[]))
  }, [])

  // Realtime — a teammate adding/editing/removing an event should
  // reflect here without a manual refresh, same shape as the
  // dashboard's sales subscription.
  useEffect(() => {
    if (!accountId) return
    const supabase = createClient()
    const channel = supabase
      .channel(`calendar:${accountId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'calendar_events', filter: `account_id=eq.${accountId}` },
        () => load(),
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [accountId, load])

  const visibleEvents = useMemo(() => {
    if (!events) return []
    if (assigneeFilter === 'all') return events
    return events.filter((ev) => ev.assigned_to === assigneeFilter)
  }, [events, assigneeFilter])

  const dayEvents = useMemo(
    () =>
      visibleEvents.filter((ev) => {
        const d = new Date(ev.starts_at)
        return (
          d.getFullYear() === selectedDate.getFullYear() &&
          d.getMonth() === selectedDate.getMonth() &&
          d.getDate() === selectedDate.getDate()
        )
      }),
    [visibleEvents, selectedDate],
  )

  function openCreate() {
    setEditingEvent(null)
    setFormOpen(true)
  }

  function openEdit(ev: CalendarEvent) {
    setEditingEvent(ev)
    setFormOpen(true)
  }

  async function handleComplete(ev: CalendarEvent) {
    const db = createClient()
    const { error } = await completeEvent(db, ev.id)
    if (error) {
      toast.error(t('toastActionFailed'))
      return
    }
    load()
  }

  async function handleReopen(ev: CalendarEvent) {
    const db = createClient()
    const { error } = await reopenEvent(db, ev.id)
    if (error) {
      toast.error(t('toastActionFailed'))
      return
    }
    load()
  }

  async function handleCancel(ev: CalendarEvent) {
    // Routed through the API (unlike complete/reopen above) so
    // cancelling also removes the linked Google Calendar event, if
    // any — see src/app/api/calendar/events/[id]/cancel/route.ts.
    const res = await fetch(`/api/calendar/events/${ev.id}/cancel`, { method: 'POST' })
    if (!res.ok) {
      toast.error(t('toastActionFailed'))
      return
    }
    load()
  }

  async function handleDelete(ev: CalendarEvent) {
    const res = await fetch(`/api/calendar/events/${ev.id}`, { method: 'DELETE' })
    if (!res.ok) {
      toast.error(t('toastActionFailed'))
      return
    }
    load()
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('pageTitle')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('pageDescription')}</p>
        </div>
        <select
          value={assigneeFilter}
          onChange={(e) => setAssigneeFilter(e.target.value)}
          className="h-9 rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary"
        >
          <option value="all">{t('filterAll')}</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.full_name || p.email}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-4 lg:col-span-2">
          <MonthGrid
            month={month}
            events={visibleEvents}
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
            onMonthChange={(d) => {
              setMonth(d)
              setSelectedDate(d)
            }}
          />
        </div>
        <div className="lg:col-span-1">
          <DayAgenda
            date={selectedDate}
            events={dayEvents}
            loading={loading}
            canWrite={canWrite}
            onNew={openCreate}
            onEdit={openEdit}
            onComplete={handleComplete}
            onReopen={handleReopen}
            onCancel={handleCancel}
            onDelete={handleDelete}
          />
        </div>
      </div>

      <EventFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        event={editingEvent}
        defaultDate={selectedDate}
        onSaved={load}
      />
    </div>
  )
}
