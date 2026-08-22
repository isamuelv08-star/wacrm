"use client"

import { ArrowDown, ArrowUp, Clock, Minus } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { ResponseTimeSummary } from '@/lib/dashboard/types'
import { GlowSeries } from './glow-series'
import { AnimatedNumber } from './animated-number'
import { EmptyState } from './empty-state'
import { Skeleton } from './skeleton'
import { cn } from '@/lib/utils'

interface ResponseTimeCardProps {
  data: ResponseTimeSummary | null
  loading: boolean
}

// Compact replacement for the old full-width response-time chart —
// same data, but sized to sit as a third card alongside Conversations
// and Pipeline Value instead of eating its own full-width row. Drops
// the axis labels, hover tooltip, and target pill in favor of a
// single headline number + a small trend sparkline, matching how the
// KPI cards up top read at a glance.
const VB_W = 220
const VB_H = 56
const LINE_COLOR = '#FF3131' // brand red — the "flame" theme's --primary

export function ResponseTimeCard({ data, loading }: ResponseTimeCardProps) {
  const t = useTranslations('Dashboard.responseTimeChart')
  const hasData = data?.buckets.some((b) => b.avgMinutes != null) ?? false

  const delta =
    data?.thisWeekAvg != null && data?.lastWeekAvg != null
      ? data.thisWeekAvg - data.lastWeekAvg
      : null

  return (
    <section className="flex h-full flex-col rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-2">
        <Clock className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold text-foreground">{t('title')}</h2>
      </div>

      {loading || !data ? (
        <div className="mt-3 flex flex-1 flex-col justify-between">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="mt-3 h-14 w-full" />
        </div>
      ) : !hasData ? (
        <div className="mt-2 flex flex-1 items-center">
          <EmptyState
            icon={Clock}
            title={t('noReplies')}
            hint={t('noRepliesHint')}
            className="min-h-0 border-none bg-transparent py-3"
          />
        </div>
      ) : (
        <div className="mt-2 flex flex-1 flex-col justify-between">
          <div>
            <p className="text-[28px] leading-none font-bold tabular-nums text-foreground">
              <AnimatedNumber value={data.thisWeekAvg ?? 0} formatter={fmt} />
            </p>
            {delta != null ? (
              <DeltaRow delta={delta} />
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">{t('thisWeek')}</p>
            )}
          </div>
          <Sparkline data={data} />
        </div>
      )}
    </section>
  )
}

function DeltaRow({ delta }: { delta: number }) {
  // Response time is a "lower is better" metric — unlike the KPI
  // cards' delta rows, a NEGATIVE change (faster replies) is the
  // positive/green outcome here, so the sign mapping is inverted.
  const sign = delta < 0 ? 1 : delta > 0 ? -1 : 0
  const tone = sign > 0 ? 'text-primary' : sign < 0 ? 'text-red-400' : 'text-muted-foreground'
  const Arrow = sign > 0 ? ArrowDown : sign < 0 ? ArrowUp : Minus
  const label = fmt(Math.abs(delta))
  return (
    <div className={cn('mt-2 flex items-center gap-1 text-sm', tone)}>
      <Arrow className="h-4 w-4" aria-hidden />
      <span className="tabular-nums">{label}</span>
    </div>
  )
}

function Sparkline({ data }: { data: ResponseTimeSummary }) {
  const buckets = data.buckets
  const maxY = Math.max(1, ...buckets.map((b) => b.avgMinutes ?? 0))
  const stepX = buckets.length > 1 ? VB_W / (buckets.length - 1) : 0
  const yFor = (v: number) => VB_H - (v / maxY) * VB_H
  const points = buckets.map((b, i) => ({ x: i * stepX, y: yFor(b.avgMinutes ?? 0) }))

  return (
    <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="mt-3 h-14 w-full" role="presentation" aria-hidden>
      <GlowSeries points={points} baselineY={VB_H} color={LINE_COLOR} strokeWidth={2} />
    </svg>
  )
}

function fmt(mins: number | null): string {
  if (mins == null) return '—'
  if (mins < 1) return `${Math.max(1, Math.round(mins * 60))}s`
  if (mins < 60) return `${mins.toFixed(1)}m`
  return `${(mins / 60).toFixed(1)}h`
}
