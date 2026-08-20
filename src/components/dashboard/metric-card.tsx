import { ArrowDown, ArrowUp, Minus } from 'lucide-react'
import type { ComponentType } from 'react'
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
  return (
    <div
      className="rounded-2xl border p-5 shadow-md shadow-black/5"
      style={{
        backgroundImage: `linear-gradient(135deg, color-mix(in oklch, ${color} 20%, var(--card)), color-mix(in oklch, ${color} 8%, var(--card)))`,
        borderColor: `color-mix(in oklch, ${color} 25%, var(--border))`,
      }}
    >
      <div className="flex items-start justify-between">
        <p className="text-sm font-medium text-muted-foreground">{title}</p>
        <div
          className="flex h-8 w-8 items-center justify-center rounded-lg"
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
