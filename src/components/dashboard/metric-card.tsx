import { ArrowDown, ArrowUp, Minus } from 'lucide-react'
import { useEffect, useState, type ComponentType } from 'react'
import { cn } from '@/lib/utils'

export type MetricCardTint = 'blue' | 'green' | 'purple' | 'amber'

// One base hue per card, matched to Tailwind's 500-weight swatches so they
// read as the same family as the rest of the app's status colors. Blended
// against `--card` via `color-mix` (not a fixed hex) so the tint stays
// correct in both light and dark mode and with any accent theme selected.
const TINT_COLORS: Record<MetricCardTint, string> = {
  blue: '#3b82f6',
  green: '#22c55e',
  purple: '#8b5cf6',
  amber: '#f59e0b',
}

interface MetricCardProps {
  title: string
  /** Pre-formatted value for display (e.g. "42" or "$1,250"). */
  value: string
  icon: ComponentType<{ className?: string }>
  /**
   * Delta-mode secondary row: arrow + delta text. Omit when the metric
   * doesn't have a sensible comparison (e.g. total pipeline value).
   */
  delta?: {
    /** Positive / negative / zero drives arrow + color. */
    sign: number
    /** Pre-formatted delta, e.g. "+3 vs yesterday". */
    label: string
  }
  /** Used instead of `delta` when the metric has a static subtitle. */
  subtitle?: string
  /** Per-card accent — each of the four dashboard KPIs gets its own. */
  tint: MetricCardTint
}

export function MetricCard({ title, value, icon: Icon, delta, subtitle, tint }: MetricCardProps) {
  const color = TINT_COLORS[tint]

  // Entrance transition — the card fades/slides in on mount instead of
  // just appearing, and the glow accent below only starts pulsing once
  // that's done. Purely presentational; no data dependency, so a plain
  // "flip true one frame after mount" is enough (no need to key it to
  // `value` — the whole card already remounts when its skeleton swaps
  // out for real data, since the dashboard page renders skeletons and
  // cards as different elements).
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div
      className={cn(
        'group relative overflow-hidden rounded-2xl border p-5 shadow-md shadow-black/5',
        'transition-all duration-500 ease-out',
        'hover:-translate-y-0.5 hover:shadow-lg',
        mounted ? 'translate-y-0 opacity-100' : 'translate-y-1.5 opacity-0',
      )}
      style={{
        backgroundImage: `linear-gradient(135deg, color-mix(in oklch, ${color} 20%, var(--card)), color-mix(in oklch, ${color} 8%, var(--card)))`,
        borderColor: `color-mix(in oklch, ${color} 25%, var(--border))`,
      }}
    >
      <div className="flex items-start justify-between">
        <p className="text-sm font-medium text-muted-foreground">{title}</p>
        <div
          className="flex h-8 w-8 items-center justify-center rounded-lg transition-transform duration-300 group-hover:scale-110"
          style={{
            backgroundColor: `color-mix(in oklch, ${color} 26%, transparent)`,
            color,
          }}
        >
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <p className="mt-3 text-[28px] leading-none font-bold tabular-nums text-foreground">
        {value}
      </p>
      {delta ? <DeltaRow sign={delta.sign} label={delta.label} /> : subtitle ? (
        <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>
      ) : null}

      {/* Glowing accent — a soft, slowly breathing bar that ties the
          card to the rest of the dashboard's "illuminated" charts
          instead of sitting flat next to them. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-5 bottom-0 h-[3px] rounded-full opacity-70"
        style={{
          background: `linear-gradient(90deg, transparent, ${color}, transparent)`,
          animation: mounted ? 'metric-glow-pulse 2.8s ease-in-out infinite' : undefined,
        }}
      />
    </div>
  )
}

function DeltaRow({ sign, label }: { sign: number; label: string }) {
  const tone =
    sign > 0
      ? 'text-primary'
      : sign < 0
      ? 'text-red-400'
      : 'text-muted-foreground'
  const Arrow = sign > 0 ? ArrowUp : sign < 0 ? ArrowDown : Minus
  return (
    <div className={cn('mt-2 flex items-center gap-1 text-sm', tone)}>
      <Arrow className="h-4 w-4" aria-hidden />
      <span className="tabular-nums">{label}</span>
    </div>
  )
}
