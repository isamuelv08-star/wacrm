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
// and Pipeline Value instead of eating its own full-width row. Mirrors
// their exact header/content/footer skeleton (border-b header, border-t
// footer) rather than just a bare number + squiggle, so it carries the
// same visual weight as its row-mates instead of reading as mostly
// empty space stretched to match their height.
const VB_W = 220
const VB_H = 70
const PLOT_H = 52 // leaves room for the day labels below the line
const LINE_COLOR = '#FF3131' // brand red — the "flame" theme's --primary

export function ResponseTimeCard({ data, loading }: ResponseTimeCardProps) {
  const t = useTranslations('Dashboard.responseTimeChart')
  const hasData = data?.buckets.some((b) => b.avgMinutes != null) ?? false

  const delta =
    data?.currentAvg != null && data?.previousAvg != null
      ? data.currentAvg - data.previousAvg
      : null

  return (
    <section className="flex h-full flex-col rounded-xl border border-border bg-card">
      <header className="border-b border-border px-5 py-4">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <Clock className="h-3.5 w-3.5 text-muted-foreground" />
          {t('title')}
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{t('description')}</p>
      </header>

      <div className="flex flex-1 flex-col p-5">
        {loading || !data ? (
          <div className="flex flex-1 flex-col justify-between">
            <Skeleton className="h-8 w-24" />
            <Skeleton className="mt-3 h-full min-h-[70px] w-full" />
          </div>
        ) : !hasData ? (
          <div className="flex flex-1 items-center">
            <EmptyState
              icon={Clock}
              title={t('noReplies')}
              hint={t('noRepliesHint')}
              className="min-h-0 border-none bg-transparent py-3"
            />
          </div>
        ) : (
          <div className="flex flex-1 flex-col">
            <p className="text-[28px] leading-none font-bold tabular-nums text-foreground">
              <AnimatedNumber value={data.currentAvg ?? 0} formatter={fmt} />
            </p>
            {delta != null && <DeltaRow delta={delta} />}
            <div className="mt-3 min-h-[70px] flex-1">
              <Sparkline data={data} />
            </div>
          </div>
        )}
      </div>

      {data && (data.currentAvg != null || data.previousAvg != null) && (
        <footer className="flex items-center justify-between border-t border-border px-5 py-3 text-xs">
          <span className="text-muted-foreground">
            {t('current')}{' '}
            <span className="font-medium text-foreground tabular-nums">{fmt(data.currentAvg)}</span>
          </span>
          <span className="text-muted-foreground">
            {t('previous')} <span className="tabular-nums">{fmt(data.previousAvg)}</span>
          </span>
        </footer>
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
  const yFor = (v: number) => PLOT_H - (v / maxY) * PLOT_H
  const points = buckets.map((b, i) => ({ x: i * stepX, y: yFor(b.avgMinutes ?? 0) }))
  // Longer ranges bucket into many more points than this narrow card
  // can label without crowding — show at most ~4 evenly-spaced labels.
  const labelStride = Math.max(1, Math.ceil(buckets.length / 4))

  return (
    <svg
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      preserveAspectRatio="none"
      className="h-full w-full"
      role="presentation"
      aria-hidden
    >
      {/* Light gridlines — fills the plot with real structure instead
          of empty space around a bare line. */}
      <line x1={0} x2={VB_W} y1={PLOT_H * 0.5} y2={PLOT_H * 0.5} stroke="var(--border)" strokeDasharray="3 3" />
      <line x1={0} x2={VB_W} y1={PLOT_H} y2={PLOT_H} stroke="var(--border)" />

      <GlowSeries points={points} baselineY={PLOT_H} color={LINE_COLOR} strokeWidth={2} />

      {buckets.map((b, i) =>
        i % labelStride === 0 ? (
          <text
            key={i}
            x={i * stepX}
            y={VB_H - 4}
            textAnchor="middle"
            className="fill-muted-foreground text-[9px]"
          >
            {b.label}
          </text>
        ) : null,
      )}
    </svg>
  )
}

function fmt(mins: number | null): string {
  if (mins == null) return '—'
  if (mins < 1) return `${Math.max(1, Math.round(mins * 60))}s`
  if (mins < 60) return `${mins.toFixed(1)}m`
  return `${(mins / 60).toFixed(1)}h`
}
