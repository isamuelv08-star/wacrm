'use client'

import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { CalendarEvent, CalendarEventType } from '@/types'
import { localDayKey } from '@/lib/dashboard/date-utils'
import { cn } from '@/lib/utils'

// One dot color per event type — decorative day-cell markers, not a
// data-encoding chart, so this reuses the app's existing ad hoc tint
// swatches (see metric-card.tsx's TINT_COLORS) rather than a
// palette-validated categorical set.
export const EVENT_TYPE_COLOR: Record<CalendarEventType, string> = {
  call: '#3b82f6',
  meeting: '#8b5cf6',
  follow_up: '#f59e0b',
  task: '#14b8a6',
  other: '#94a3b8',
}

interface MonthGridProps {
  month: Date
  events: CalendarEvent[]
  selectedDate: Date
  onSelectDate: (d: Date) => void
  onMonthChange: (d: Date) => void
}

export function MonthGrid({ month, events, selectedDate, onSelectDate, onMonthChange }: MonthGridProps) {
  const t = useTranslations('Calendar')

  const gridStart = startOfWeek(startOfMonth(month), { weekStartsOn: 1 })
  const gridEnd = endOfWeek(endOfMonth(month), { weekStartsOn: 1 })
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd })

  const eventsByDay = new Map<string, CalendarEvent[]>()
  for (const ev of events) {
    const key = localDayKey(new Date(ev.starts_at))
    const bucket = eventsByDay.get(key) ?? []
    bucket.push(ev)
    eventsByDay.set(key, bucket)
  }

  const weekdayLabels = [
    t('weekdayMon'),
    t('weekdayTue'),
    t('weekdayWed'),
    t('weekdayThu'),
    t('weekdayFri'),
    t('weekdaySat'),
    t('weekdaySun'),
  ]

  return (
    <div className="flex flex-col">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground capitalize">
          {month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
        </h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onMonthChange(subMonths(month, 1))}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label={t('prevMonth')}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onMonthChange(new Date())}
            className="rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {t('today')}
          </button>
          <button
            type="button"
            onClick={() => onMonthChange(addMonths(month, 1))}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label={t('nextMonth')}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {weekdayLabels.map((label) => (
          <div key={label} className="py-1 text-center text-[11px] font-medium text-muted-foreground">
            {label}
          </div>
        ))}

        {days.map((day) => {
          const key = localDayKey(day)
          const dayEvents = eventsByDay.get(key) ?? []
          const inMonth = isSameMonth(day, month)
          const selected = isSameDay(day, selectedDate)
          const today = isToday(day)
          const typesPresent = Array.from(new Set(dayEvents.map((e) => e.type))).slice(0, 4)

          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelectDate(day)}
              className={cn(
                'flex aspect-square flex-col items-center justify-start gap-1 rounded-lg border border-transparent p-1.5 text-sm transition-colors',
                inMonth ? 'text-foreground' : 'text-muted-foreground/40',
                selected
                  ? 'border-primary bg-primary/10'
                  : 'hover:bg-muted',
              )}
            >
              <span
                className={cn(
                  'flex h-6 w-6 items-center justify-center rounded-full text-xs',
                  today && !selected && 'bg-muted font-semibold text-foreground',
                  selected && 'bg-primary font-semibold text-primary-foreground',
                )}
              >
                {format(day, 'd')}
              </span>
              {typesPresent.length > 0 && (
                <span className="flex items-center gap-0.5">
                  {typesPresent.map((type) => (
                    <span
                      key={type}
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ background: EVENT_TYPE_COLOR[type] }}
                    />
                  ))}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
