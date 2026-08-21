"use client"

import { useId } from 'react'
import { smoothAreaPath, smoothPath, type ChartPoint } from '@/lib/dashboard/chart-path'

interface GlowSeriesProps {
  points: ChartPoint[]
  /** Bottom of the chart's plot area — where the gradient fill fades out. */
  baselineY: number
  color: string
  /** Renders the gradient fill under the curve. Default true. */
  showArea?: boolean
  strokeWidth?: number
}

/**
 * One glowing, gradient-filled, Catmull-Rom-smoothed line for the
 * dashboard's line charts (conversations over time, response time).
 * The "glow" is a wider, blurred duplicate of the same path rendered
 * underneath the crisp stroke — more controllable than an SVG
 * `feGaussianBlur` filter, which tends to also blur (and clip) the
 * fill it's attached to.
 *
 * `useId()` keys the gradient/filter defs so multiple charts (or
 * multiple series in one chart) never collide on `url(#...)` ids.
 */
export function GlowSeries({
  points,
  baselineY,
  color,
  showArea = true,
  strokeWidth = 2.5,
}: GlowSeriesProps) {
  const uid = useId()
  const gradientId = `glow-area-${uid}`
  const line = smoothPath(points)

  return (
    <g>
      {showArea && (
        <>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.28} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <path d={smoothAreaPath(points, baselineY)} fill={`url(#${gradientId})`} stroke="none" />
        </>
      )}

      {/* Glow layer — same curve, wider + blurred + dim, sitting behind
          the crisp line so it reads as an ambient light rather than a
          harsh outline. */}
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth * 2.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.35}
        style={{ filter: 'blur(4px)' }}
      />

      {/* Crisp line on top. */}
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </g>
  )
}
