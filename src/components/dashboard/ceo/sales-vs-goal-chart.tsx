"use client"

import { useEffect, useMemo, useRef, useState } from 'react'
import { TrendingUp } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { SalesVsGoalPoint } from '@/lib/dashboard/ceo-types'
import { formatCurrency, formatCompactNumber } from '@/lib/currency'
import { GlowSeries } from '../glow-series'
import { EmptyState } from '../empty-state'
import { Skeleton } from '../skeleton'
import { cn } from '@/lib/utils'

interface SalesVsGoalChartProps {
  data: SalesVsGoalPoint[] | null
  loading: boolean
  currency: string
}

const VB_W = 760
// Shorter than the old full-width 260 — this chart now shares a row
// with Commercial metrics' compact stat card instead of spanning the
// whole width, so a shorter, denser plot reads as "paired with its
// neighbor" rather than towering over it.
const VB_H = 220
const PADDING = { top: 16, right: 16, bottom: 28, left: 48 }
const ACTUAL_COLOR = '#22c55e'
// The goal is a reference threshold, not a second identity competing
// with "Actual" — rendering it as a neutral dashed line (rather than
// a second saturated hue) is both the standard target-line convention
// and sidesteps a real problem the previous amber pairing had: it
// failed this app's own colorblind-separation check against the
// green actual line, and the hover tooltip's goal dot was already
// neutral gray while the line and legend swatch were amber — an
// inconsistent identity for the same series.
const GOAL_COLOR = 'var(--muted-foreground)'

export function SalesVsGoalChart({ data, loading, currency }: SalesVsGoalChartProps) {
  const t = useTranslations('Dashboard.ceo.salesVsGoal')
  const hasData = (data ?? []).some((p) => p.actual > 0 || p.goal)

  // Attainment for the whole selected period — the headline this
  // chart exists to answer ("are we on track?") surfaced right in the
  // header instead of making the reader trace the plot themselves.
  // `actual`/`goal` are now cumulative running totals (see
  // loadSalesVsGoal's doc comment), so the LAST point already holds
  // the period's full actual-vs-target — no need to sum across
  // buckets (summing cumulative values would wildly overcount).
  const attainmentPct = useMemo(() => {
    if (!data || data.length === 0) return null
    const last = data[data.length - 1]
    return last.goal && last.goal > 0 ? (last.actual / last.goal) * 100 : null
  }, [data])

  return (
    <section className="flex h-full flex-col rounded-xl border border-border bg-card">
      <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{t('title')}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('description')}</p>
        </div>
        {attainmentPct != null && (
          <span
            className={cn(
              'shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold tabular-nums',
              attainmentPct >= 100
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                : attainmentPct >= 70
                  ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                  : 'border-rose-500/40 bg-rose-500/10 text-rose-300',
            )}
          >
            {t('attainment', { pct: attainmentPct.toFixed(0) })}
          </span>
        )}
      </header>

      <div className="flex-1 p-5">
        {loading || !data ? (
          <Skeleton className="h-[220px] w-full" />
        ) : !hasData ? (
          <EmptyState icon={TrendingUp} title={t('noData')} hint={t('noDataHint')} />
        ) : (
          <LineSvg data={data} currency={currency} />
        )}
      </div>

      <footer className="flex items-center gap-4 border-t border-border px-5 py-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: ACTUAL_COLOR }} />
          {t('actual')}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-1 w-3 rounded-full" style={{ background: GOAL_COLOR }} />
          {t('goal')}
        </span>
      </footer>
    </section>
  )
}

function LineSvg({ data, currency }: { data: SalesVsGoalPoint[]; currency: string }) {
  const t = useTranslations('Dashboard.ceo.salesVsGoal')
  const [hover, setHover] = useState<{ idx: number; tooltipLeftPx: number } | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  const { maxY, niceTicks } = useMemo(() => {
    const max = data.reduce((m, p) => Math.max(m, p.actual, p.goal ?? 0), 0)
    const ceil = niceCeil(max)
    const ticks = [0, ceil / 4, ceil / 2, (3 * ceil) / 4, ceil]
    return { maxY: ceil, niceTicks: Array.from(new Set(ticks)) }
  }, [data])

  const chartW = VB_W - PADDING.left - PADDING.right
  const chartH = VB_H - PADDING.top - PADDING.bottom
  const stepX = data.length > 1 ? chartW / (data.length - 1) : 0
  // A monthly view only ever had ≤6 points, so one label per point
  // fit fine. Now that the range can bucket into up to 30 points (a
  // 30-day or 6-month/1-year view), labeling every one of them would
  // overlap into an unreadable smear — show at most ~8 evenly spaced.
  const labelStride = Math.max(1, Math.ceil(data.length / 8))
  const yFor = (v: number) => (maxY === 0 ? PADDING.top + chartH : PADDING.top + chartH - (v / maxY) * chartH)
  const xFor = (i: number) => PADDING.left + i * stepX
  const baselineY = PADDING.top + chartH

  const actualPoints = data.map((p, i) => ({ x: xFor(i), y: yFor(p.actual) }))
  const goalPoints = data
    .map((p, i) => ({ i, goal: p.goal }))
    .filter((p): p is { i: number; goal: number } => p.goal != null)
    .map((p) => ({ x: xFor(p.i), y: yFor(p.goal) }))
  const goalPath = goalPoints.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')

  useEffect(() => {
    const svg = svgRef.current
    const wrap = wrapRef.current
    if (!svg || !wrap) return
    const onMove = (e: MouseEvent) => {
      const ctm = svg.getScreenCTM()
      if (!ctm) return
      const pt = svg.createSVGPoint()
      pt.x = e.clientX
      pt.y = e.clientY
      const local = pt.matrixTransform(ctm.inverse())
      const xVb = local.x
      if (xVb < PADDING.left - 8 || xVb > VB_W - PADDING.right + 8) {
        setHover(null)
        return
      }
      const relative = xVb - PADDING.left
      const idx = Math.max(0, Math.min(data.length - 1, Math.round(stepX === 0 ? 0 : relative / stepX)))
      const dataPointPt = svg.createSVGPoint()
      dataPointPt.x = PADDING.left + idx * stepX
      dataPointPt.y = 0
      const screen = dataPointPt.matrixTransform(ctm)
      const wrapRect = wrap.getBoundingClientRect()
      setHover({ idx, tooltipLeftPx: screen.x - wrapRect.left })
    }
    const onLeave = () => setHover(null)
    svg.addEventListener('mousemove', onMove)
    svg.addEventListener('mouseleave', onLeave)
    return () => {
      svg.removeEventListener('mousemove', onMove)
      svg.removeEventListener('mouseleave', onLeave)
    }
  }, [data, stepX])

  const hovered = hover !== null ? data[hover.idx] : null

  return (
    <div ref={wrapRef} className="relative w-full">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        preserveAspectRatio="none"
        className="h-[220px] w-full"
        role="img"
        aria-label={t('ariaLabel')}
      >
        {niceTicks.map((tick) => {
          const y = yFor(tick)
          return (
            <g key={tick}>
              <line x1={PADDING.left} x2={VB_W - PADDING.right} y1={y} y2={y} stroke="var(--border)" strokeWidth={1} />
              <text x={PADDING.left - 8} y={y} textAnchor="end" dominantBaseline="middle" className="fill-muted-foreground text-[10px]">
                {formatCompactNumber(tick)}
              </text>
            </g>
          )
        })}

        {data.map((p, i) =>
          i % labelStride === 0 ? (
            <text key={i} x={xFor(i)} y={VB_H - 8} textAnchor="middle" className="fill-muted-foreground text-[10px]">
              {p.label}
            </text>
          ) : null,
        )}

        <GlowSeries points={actualPoints} baselineY={baselineY} color={ACTUAL_COLOR} />

        {goalPath && (
          <path d={goalPath} fill="none" stroke={GOAL_COLOR} strokeWidth={1.75} strokeDasharray="5 4" strokeLinecap="round" opacity={0.85} />
        )}

        {/* Label the target line's own endpoint with the actual
            configured number (the account's real monthly goal from
            Settings, range-scaled) — the whole point of the cumulative
            redesign is that this number is now traceable on the chart
            itself, not a divided-by-days figure nobody typed in. */}
        {goalPoints.length > 0 && data[data.length - 1].goal != null && (
          <text
            x={goalPoints[goalPoints.length - 1].x - 6}
            y={goalPoints[goalPoints.length - 1].y - 8}
            textAnchor="end"
            className="fill-muted-foreground text-[10px] font-medium tabular-nums"
          >
            {formatCompactNumber(data[data.length - 1].goal as number)}
          </text>
        )}

        {/* Current-month marker — a soft breathing glow on the most
            recent actual point, the same "alive" cue the KPI cards use,
            so the reader's eye lands on "where are we right now" first. */}
        {actualPoints.length > 0 && (
          <circle
            cx={actualPoints[actualPoints.length - 1].x}
            cy={actualPoints[actualPoints.length - 1].y}
            r={5}
            fill={ACTUAL_COLOR}
            opacity={0.35}
            style={{ animation: 'metric-glow-pulse 2.4s ease-in-out infinite', transformOrigin: `${actualPoints[actualPoints.length - 1].x}px ${actualPoints[actualPoints.length - 1].y}px` }}
          />
        )}
        {actualPoints.length > 0 && (
          <circle
            cx={actualPoints[actualPoints.length - 1].x}
            cy={actualPoints[actualPoints.length - 1].y}
            r={3}
            fill={ACTUAL_COLOR}
          />
        )}

        {hover !== null && (
          <g pointerEvents="none">
            <line x1={xFor(hover.idx)} x2={xFor(hover.idx)} y1={PADDING.top} y2={PADDING.top + chartH} stroke="var(--muted-foreground)" strokeDasharray="3 3" />
            <circle cx={xFor(hover.idx)} cy={yFor(data[hover.idx].actual)} r={3.5} fill={ACTUAL_COLOR} />
            {data[hover.idx].goal != null && (
              <circle cx={xFor(hover.idx)} cy={yFor(data[hover.idx].goal ?? 0)} r={3} fill="var(--muted-foreground)" />
            )}
          </g>
        )}
      </svg>

      {hovered && hover !== null && (
        <div
          className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-md border border-border bg-popover px-2.5 py-1.5 text-[11px] shadow-lg"
          style={{ left: `${hover.tooltipLeftPx}px` }}
        >
          <div className="font-medium text-popover-foreground">{hovered.label}</div>
          <div className="mt-1 flex flex-col gap-0.5">
            <span className="flex items-center gap-1.5 font-medium text-popover-foreground">
              <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: ACTUAL_COLOR }} />
              {formatCurrency(hovered.actual, currency)}
            </span>
            {hovered.goal != null && (
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground" />
                {t('tooltipGoal', { value: formatCurrency(hovered.goal, currency) })}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function niceCeil(max: number): number {
  if (max <= 0) return 4
  const pow = Math.pow(10, Math.floor(Math.log10(max)))
  const normalised = max / pow
  let nice: number
  if (normalised <= 1) nice = 1
  else if (normalised <= 2) nice = 2
  else if (normalised <= 5) nice = 5
  else nice = 10
  return nice * pow
}
