// Pure SVG path helpers for the dashboard's "glowing line" charts
// (conversations over time, response time). Kept dependency-free and
// unit-testable — no DOM, no React.

export interface ChartPoint {
  x: number
  y: number
}

/**
 * Catmull-Rom-to-Bezier smoothed path through every point (not just an
 * approximation near them — the curve always passes exactly through
 * each data point, so hover dots placed at the raw point still sit
 * exactly on the drawn line). This is what turns the old sharp
 * straight-segment "V" peaks into the rounded, flowing look.
 */
export function smoothPath(points: ChartPoint[]): string {
  if (points.length === 0) return ''
  if (points.length === 1) return `M${points[0].x},${points[0].y}`
  if (points.length === 2) {
    return `M${points[0].x},${points[0].y} L${points[1].x},${points[1].y}`
  }

  let d = `M${points[0].x},${points[0].y}`
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i === 0 ? i : i - 1]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[i + 2 < points.length ? i + 2 : i + 1]
    // Tension 1/6 — the standard Catmull-Rom -> cubic-Bezier conversion.
    const cp1x = p1.x + (p2.x - p0.x) / 6
    const cp1y = p1.y + (p2.y - p0.y) / 6
    const cp2x = p2.x - (p3.x - p1.x) / 6
    const cp2y = p2.y - (p3.y - p1.y) / 6
    d += ` C${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`
  }
  return d
}

/**
 * Same smoothed line, closed down to `baselineY` and back to the
 * first point — the fillable region for the gradient area under the
 * curve.
 */
export function smoothAreaPath(points: ChartPoint[], baselineY: number): string {
  if (points.length === 0) return ''
  const line = smoothPath(points)
  const last = points[points.length - 1]
  const first = points[0]
  return `${line} L${last.x},${baselineY} L${first.x},${baselineY} Z`
}
