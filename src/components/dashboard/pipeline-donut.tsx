"use client"

import { useEffect, useId, useState } from 'react'
import { GitBranch } from 'lucide-react'
import type { PipelineDonutData } from '@/lib/dashboard/types'
import { formatCurrencyShort } from '@/lib/currency'
import { cn } from '@/lib/utils'
import { EmptyState } from './empty-state'
import { Skeleton } from './skeleton'

interface PipelineDonutProps {
  data: PipelineDonutData | null
  loading: boolean
  /** Account default currency for the totals. */
  currency: string
}

import { useTranslations } from 'next-intl'

export function PipelineDonut({ data, loading, currency }: PipelineDonutProps) {
  const t = useTranslations('Dashboard.pipelineDonut')
  // Lifted above the ring so hovering a legend row highlights the
  // matching arc (and vice versa) — one shared "what's focused" state.
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  return (
    <section className="flex h-full flex-col rounded-xl border border-border bg-card">
      <header className="border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold text-foreground">{t('title')}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t('description')}
        </p>
      </header>

      <div className="flex flex-1 flex-col p-5">
        {loading || !data ? (
          <Skeleton className="h-56 w-full" />
        ) : data.stages.length === 0 ? (
          <EmptyState
            icon={GitBranch}
            title={t('noOpenDeals')}
            hint={t('noOpenDealsHint')}
          />
        ) : (
          <>
            <Donut
              data={data}
              currency={currency}
              hoveredId={hoveredId}
              onHover={setHoveredId}
            />
            <ul className="mt-5 space-y-2">
              {data.stages.map((s) => (
                <li
                  key={s.id}
                  onMouseEnter={() => setHoveredId(s.id)}
                  onMouseLeave={() => setHoveredId((cur) => (cur === s.id ? null : cur))}
                  className={cn(
                    'flex items-center gap-3 rounded-md px-1.5 py-1 text-xs transition-colors',
                    hoveredId === s.id && 'bg-muted/60',
                  )}
                >
                  <span
                    className="h-2.5 w-2.5 flex-shrink-0 rounded-full transition-transform"
                    style={{
                      background: s.color,
                      transform: hoveredId === s.id ? 'scale(1.3)' : undefined,
                      boxShadow: hoveredId === s.id ? `0 0 8px ${s.color}` : undefined,
                    }}
                    aria-hidden
                  />
                  <span className="flex-1 truncate text-muted-foreground">{s.name}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {t('dealCount', { count: s.dealCount })}
                  </span>
                  <span className="w-20 text-right text-muted-foreground tabular-nums">
                    {formatCurrencyShort(s.totalValue, currency)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  )
}

// ------------------------------------------------------------
// SVG ring. 200×200 viewBox, 12px ring width. We draw one <path>
// per stage using an SVG arc from startAngle → endAngle. Gaps
// between segments are implied by a thin slate-900 stroke between
// them for a cleaner look.
//
// Two "dynamic" touches beyond the plain static ring:
//   - Draw-in animation on first paint (stroke-dashoffset from the
//     segment's own arc length down to 0 — analytic, no DOM
//     measurement needed since these are true circular arcs).
//   - Hover: the focused segment gets a wider, glowing stroke and the
//     center label swaps from the pipeline total to that stage's own
//     value, so the ring reads as something you explore, not a static
//     picture.
// ------------------------------------------------------------
function Donut({
  data,
  currency,
  hoveredId,
  onHover,
}: {
  data: PipelineDonutData
  currency: string
  hoveredId: string | null
  onHover: (id: string | null) => void
}) {
  const t = useTranslations('Dashboard.pipelineDonut')
  const uid = useId()
  const size = 200
  const r = 80
  const ringWidth = 18
  const cx = size / 2
  const cy = size / 2

  // Small slices would render as slivers that disappear into stroke
  // rounding. We give each stage a floor share purely for rendering,
  // but keep the labels/legend honest with the actual totals.
  const totalRaw = data.totalValue || 1
  const minFrac = 0.02
  const rawShares = data.stages.map((s) => s.totalValue / totalRaw)
  const floored = rawShares.map((x) => Math.max(x, minFrac))
  const floorSum = floored.reduce((a, b) => a + b, 0)
  const shares = floored.map((x) => x / floorSum)

  // Build a cumulative-offset array, then map stages → arc paths. Using
  // a pre-computed offsets array avoids the Next 16 React Compiler's
  // "Cannot reassign variable after render completes" rule.
  const offsets: number[] = [0]
  for (let i = 0; i < shares.length; i++) offsets.push(offsets[i] + shares[i])
  const segments = data.stages.map((s, i) => {
    const start = offsets[i] * Math.PI * 2 - Math.PI / 2
    const end = offsets[i + 1] * Math.PI * 2 - Math.PI / 2
    return {
      path: arcPath(cx, cy, r, start, end),
      // Analytic arc length (radius * angle) — exact for a circular
      // arc, so the draw-in animation needs no getTotalLength() call.
      length: r * (end - start),
      color: s.color,
      id: s.id,
      name: s.name,
      dealCount: s.dealCount,
      totalValue: s.totalValue,
    }
  })

  // Flips from "fully retracted" to "fully drawn" one frame after
  // mount, so the transition actually has something to animate from
  // instead of both states landing in the same paint.
  const [drawn, setDrawn] = useState(false)
  useEffect(() => {
    const raf = requestAnimationFrame(() => setDrawn(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  const hovered = segments.find((s) => s.id === hoveredId) ?? null

  return (
    <div className="flex items-center justify-center">
      <svg viewBox={`0 0 ${size} ${size}`} className="h-48 w-48" role="img" aria-label={t('ariaLabel')}>
        <defs>
          <filter id={`donut-glow-${uid}`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {/* background ring */}
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--muted)" strokeWidth={ringWidth} />
        {segments.map((seg) => {
          const isHovered = seg.id === hoveredId
          const dimmed = hoveredId !== null && !isHovered
          return (
            <path
              key={seg.id}
              d={seg.path}
              fill="none"
              stroke={seg.color}
              strokeWidth={isHovered ? ringWidth + 5 : ringWidth}
              strokeLinecap="round"
              strokeDasharray={seg.length}
              strokeDashoffset={drawn ? 0 : seg.length}
              opacity={dimmed ? 0.35 : 1}
              filter={isHovered ? `url(#donut-glow-${uid})` : undefined}
              onMouseEnter={() => onHover(seg.id)}
              onMouseLeave={() => onHover(null)}
              className="cursor-pointer transition-[stroke-width,stroke-dashoffset,opacity] duration-700 ease-out"
              style={{ transitionProperty: 'stroke-dashoffset, stroke-width, opacity' }}
            />
          )
        })}
        {/* center label — hovered stage's own value, or the pipeline total */}
        <text
          x={cx}
          y={cy - 6}
          textAnchor="middle"
          className="fill-muted-foreground text-[11px] transition-opacity"
        >
          {hovered ? truncateLabel(hovered.name) : t('total')}
        </text>
        <text
          x={cx}
          y={cy + 14}
          textAnchor="middle"
          className="fill-foreground text-[18px] font-semibold tabular-nums transition-opacity"
        >
          {formatCurrencyShort(hovered ? hovered.totalValue : data.totalValue, currency)}
        </text>
      </svg>
    </div>
  )
}

function truncateLabel(s: string, max = 14): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

function arcPath(cx: number, cy: number, r: number, startRad: number, endRad: number): string {
  const x1 = cx + r * Math.cos(startRad)
  const y1 = cy + r * Math.sin(startRad)
  const x2 = cx + r * Math.cos(endRad)
  const y2 = cy + r * Math.sin(endRad)
  const largeArc = endRad - startRad > Math.PI ? 1 : 0
  return `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`
}
