"use client"

import { useEffect, useId, useState } from 'react'
import { Filter } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { FunnelStep } from '@/lib/dashboard/ceo-types'
import { formatCurrency } from '@/lib/currency'
import { EmptyState } from '../empty-state'
import { Skeleton } from '../skeleton'

interface SalesFunnelProps {
  data: FunnelStep[] | null
  loading: boolean
  currency: string
}

export function SalesFunnel({ data, loading, currency }: SalesFunnelProps) {
  const t = useTranslations('Dashboard.ceo.funnel')
  const hasData = (data ?? []).some((s) => s.count > 0)

  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold text-foreground">{t('title')}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{t('description')}</p>
      </header>
      <div className="p-5">
        {loading || !data ? (
          <Skeleton className="h-[260px] w-full" />
        ) : !hasData ? (
          <EmptyState icon={Filter} title={t('noData')} hint={t('noDataHint')} />
        ) : (
          <FunnelChart data={data} currency={currency} />
        )}
      </div>
    </section>
  )
}

// ------------------------------------------------------------
// A true horizontal funnel: N stages drawn as N-1 tapering trapezoid
// bands, each one's left edge = the stage it starts from, right edge
// = the count it narrows down to at the next stage. Colored with a
// single gradient sweeping across the whole shape (cool → warm, i.e.
// "the deal gets hotter as it nears close") rather than per-segment
// flat fills, so it reads as one continuous funnel instead of N
// disconnected bars — which was the whole point of moving off the
// old bar-list design.
// ------------------------------------------------------------
const VB_W = 760
const VB_H = 260
const PADDING = { top: 24, right: 28, bottom: 64, left: 28 }
const MIN_HEIGHT_FRAC = 0.14

function FunnelChart({ data, currency }: { data: FunnelStep[]; currency: string }) {
  const t = useTranslations('Dashboard.ceo.funnel')
  const uid = useId()
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const [drawn, setDrawn] = useState(false)
  useEffect(() => {
    const raf = requestAnimationFrame(() => setDrawn(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  const plotW = VB_W - PADDING.left - PADDING.right
  const plotH = VB_H - PADDING.top - PADDING.bottom
  const centerY = PADDING.top + plotH / 2
  const n = data.length
  const segW = n > 1 ? plotW / (n - 1) : plotW

  const maxCount = Math.max(1, ...data.map((s) => s.count))
  const heights = data.map((s) => Math.max(MIN_HEIGHT_FRAC, s.count / maxCount) * plotH)
  const xFor = (i: number) => PADDING.left + i * segW
  const labelFor = (s: FunnelStep) => (s.key === 'leads' ? t('leads') : s.key === 'won' ? t('won') : s.label)

  return (
    <div className="relative w-full">
      <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="h-[260px] w-full" role="img" aria-label={t('ariaLabel')}>
        <defs>
          <linearGradient id={`funnel-fill-${uid}`} gradientUnits="userSpaceOnUse" x1={PADDING.left} y1={0} x2={VB_W - PADDING.right} y2={0}>
            <stop offset="0%" stopColor="#3b82f6" />
            <stop offset="45%" stopColor="#8b5cf6" />
            <stop offset="100%" stopColor="#FF3131" />
          </linearGradient>
          <filter id={`funnel-glow-${uid}`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Trapezoid bands — one per gap between consecutive stages. */}
        {data.slice(0, -1).map((step, i) => {
          const next = data[i + 1]
          const x0 = xFor(i)
          const x1 = xFor(i + 1)
          const h0 = heights[i]
          const h1 = heights[i + 1]
          const path = roundedQuadPath(
            [
              { x: x0, y: centerY - h0 / 2 },
              { x: x1, y: centerY - h1 / 2 },
              { x: x1, y: centerY + h1 / 2 },
              { x: x0, y: centerY + h0 / 2 },
            ],
            10,
          )
          const isHovered = hoverIdx === i
          const dimmed = hoverIdx !== null && !isHovered
          const pct = step.count > 0 ? (next.count / step.count) * 100 : null
          const midX = (x0 + x1) / 2
          const showInlinePct = pct != null && Math.min(h0, h1) > 34

          return (
            <g key={step.key}>
              <path
                d={path}
                fill={`url(#funnel-fill-${uid})`}
                opacity={dimmed ? 0.3 : drawn ? 0.88 : 0}
                filter={isHovered ? `url(#funnel-glow-${uid})` : undefined}
                className="transition-[opacity,transform] duration-500 ease-out"
                style={{
                  transitionDelay: drawn ? `${i * 90}ms` : '0ms',
                  transformBox: 'fill-box',
                  transformOrigin: 'center',
                  transform: isHovered ? 'scaleY(1.06)' : 'scaleY(1)',
                }}
              />
              {/* Divider between bands, brightened where they touch so the
                  taper reads as one continuous shape rather than a stack. */}
              {i > 0 && (
                <line x1={x0} x2={x0} y1={centerY - h0 / 2} y2={centerY + h0 / 2} stroke="var(--card)" strokeWidth={1.5} opacity={0.6} />
              )}
              {showInlinePct && (
                <text
                  x={midX}
                  y={centerY}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="pointer-events-none fill-white text-[13px] font-bold"
                  style={{ opacity: drawn ? 1 : 0, transition: 'opacity 500ms ease-out', transitionDelay: `${i * 90 + 200}ms` }}
                >
                  {pct!.toFixed(0)}%
                </text>
              )}
            </g>
          )
        })}

        {/* Stage labels + counts, one under each boundary. */}
        {data.map((step, i) => {
          const x = xFor(i)
          const anchor = i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'
          const isHovered = hoverIdx === i || hoverIdx === i - 1
          return (
            <g
              key={`label-${step.key}`}
              style={{ opacity: drawn ? 1 : 0, transition: 'opacity 400ms ease-out', transitionDelay: `${i * 90 + 150}ms` }}
            >
              <circle cx={x} cy={centerY + Math.max(heights[i] / 2, 10) + 14} r={2.5} fill={isHovered ? '#FF3131' : 'var(--muted-foreground)'} className="transition-colors duration-300" />
              <text x={x} y={centerY + Math.max(heights[i] / 2, 10) + 30} textAnchor={anchor} className="fill-foreground text-[12px] font-semibold">
                {labelFor(step)}
              </text>
              <text x={x} y={centerY + Math.max(heights[i] / 2, 10) + 46} textAnchor={anchor} className="fill-muted-foreground text-[11px] tabular-nums">
                {t('dealCount', { count: step.count })}
              </text>
            </g>
          )
        })}

        {/* Hover targets — one per band, each spanning exactly that
            band's own x-range (not centered on the label points),
            and extending down through the label row below it so
            mousing a stage's label highlights the same band as
            mousing its shape. */}
        {data.slice(0, -1).map((step, i) => (
          <rect
            key={`hit-${step.key}`}
            x={xFor(i)}
            y={PADDING.top}
            width={segW}
            height={VB_H - PADDING.top}
            fill="transparent"
            onMouseEnter={() => setHoverIdx(i)}
            onMouseLeave={() => setHoverIdx((cur) => (cur === i ? null : cur))}
            className="cursor-pointer"
          />
        ))}
      </svg>

      {/* Floating tooltip — richer detail than the static labels can
          fit (value + conversion%), the "pro" hover payoff. */}
      {hoverIdx !== null && (
        <FunnelTooltip step={data[hoverIdx]} next={data[hoverIdx + 1] ?? null} currency={currency} x={xFor(hoverIdx) + segW / 2} />
      )}
    </div>
  )
}

function FunnelTooltip({
  step,
  next,
  currency,
  x,
}: {
  step: FunnelStep
  next: FunnelStep | null
  currency: string
  x: number
}) {
  const t = useTranslations('Dashboard.ceo.funnel')
  const label = step.key === 'leads' ? t('leads') : step.key === 'won' ? t('won') : step.label
  const pct = next && step.count > 0 ? (next.count / step.count) * 100 : null
  const leftPct = (x / VB_W) * 100

  return (
    <div
      className="pointer-events-none absolute top-1 z-10 -translate-x-1/2 rounded-md border border-border bg-popover px-3 py-2 text-[11px] shadow-lg"
      style={{ left: `${leftPct}%` }}
    >
      <div className="font-semibold text-popover-foreground">{label}</div>
      <div className="mt-1 flex flex-col gap-0.5 text-muted-foreground">
        <span>{t('dealCount', { count: step.count })}</span>
        {step.value != null && <span className="tabular-nums">{formatCurrency(step.value, currency)}</span>}
        {pct != null && <span className="tabular-nums text-primary">{t('conversionToNext', { pct: pct.toFixed(0) })}</span>}
      </div>
    </div>
  )
}

/**
 * A quadrilateral's path with each corner rounded — SVG has no native
 * "rounded polygon," so this insets each corner along its two
 * adjacent edges by `radius` and joins the shape with a quadratic
 * curve through the original corner point. Every dashboard card
 * elsewhere uses rounded corners (rounded-xl/2xl); the funnel's sharp
 * trapezoids were the one exception.
 *
 * Radius is clamped per-corner to half of whichever adjacent edge is
 * shorter, so a band too thin to fit the requested radius degrades to
 * a smaller one instead of producing a self-intersecting path.
 */
function roundedQuadPath(points: { x: number; y: number }[], radius: number): string {
  const n = points.length
  const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.hypot(b.x - a.x, b.y - a.y)

  const parts: string[] = []
  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n]
    const curr = points[i]
    const next = points[(i + 1) % n]
    const dPrev = dist(prev, curr)
    const dNext = dist(curr, next)
    const rIn = Math.min(radius, dPrev / 2)
    const rOut = Math.min(radius, dNext / 2)
    const inX = curr.x + ((prev.x - curr.x) / (dPrev || 1)) * rIn
    const inY = curr.y + ((prev.y - curr.y) / (dPrev || 1)) * rIn
    const outX = curr.x + ((next.x - curr.x) / (dNext || 1)) * rOut
    const outY = curr.y + ((next.y - curr.y) / (dNext || 1)) * rOut
    parts.push(`${i === 0 ? 'M' : 'L'} ${inX} ${inY}`)
    parts.push(`Q ${curr.x} ${curr.y} ${outX} ${outY}`)
  }
  parts.push('Z')
  return parts.join(' ')
}
