"use client"

import { useEffect, useMemo, useRef, useState } from 'react'
import { TrendingUp } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { SalesVsGoalPoint } from '@/lib/dashboard/ceo-types'
import { formatCurrency, formatCompactNumber } from '@/lib/currency'
import { GlowSeries } from '../glow-series'
import { EmptyState } from '../empty-state'
import { Skeleton } from '../skeleton'

interface SalesVsGoalChartProps {
  data: SalesVsGoalPoint[] | null
  loading: boolean
  currency: string
}

const VB_W = 760
const VB_H = 260
const PADDING = { top: 16, right: 16, bottom: 28, left: 48 }
const ACTUAL_COLOR = '#22c55e'

export function SalesVsGoalChart({ data, loading, currency }: SalesVsGoalChartProps) {
  const t = useTranslations('Dashboard.ceo.salesVsGoal')
  const hasData = (data ?? []).some((p) => p.actual > 0 || p.goal)

  return (
    <section className="flex h-full flex-col rounded-xl border border-border bg-card">
      <header className="flex items-center justify-between border-b border-border px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{t('title')}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('description')}</p>
        </div>
      </header>

      <div className="flex-1 p-5">
        {loading || !data ? (
          <Skeleton className="h-[260px] w-full" />
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
          <span className="inline-block h-1.5 w-3 rounded-full border-t-2 border-dashed border-muted-foreground" />
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
        className="h-[260px] w-full"
        role="img"
        aria-label={t('ariaLabel')}
      >
        {niceTicks.map((tick) => {
          const y = yFor(tick)
          return (
            <g key={tick}>
              <line x1={PADDING.left} x2={VB_W - PADDING.right} y1={y} y2={y} stroke="var(--border)" strokeDasharray="3 3" />
              <text x={PADDING.left - 8} y={y} textAnchor="end" dominantBaseline="middle" className="fill-muted-foreground text-[10px]">
                {formatCompactNumber(tick)}
              </text>
            </g>
          )
        })}

        {data.map((p, i) => (
          <text key={p.month} x={xFor(i)} y={VB_H - 8} textAnchor="middle" className="fill-muted-foreground text-[10px]">
            {shortMonthLabel(p.month)}
          </text>
        ))}

        <GlowSeries points={actualPoints} baselineY={baselineY} color={ACTUAL_COLOR} />

        {goalPath && (
          <path d={goalPath} fill="none" stroke="var(--muted-foreground)" strokeWidth={1.5} strokeDasharray="5 4" strokeLinecap="round" />
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
          <div className="font-medium text-popover-foreground">{longMonthLabel(hovered.month)}</div>
          <div className="mt-1 flex flex-col gap-0.5">
            <span className="flex items-center gap-1.5" style={{ color: ACTUAL_COLOR }}>
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

function shortMonthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'short' })
}

function longMonthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
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
