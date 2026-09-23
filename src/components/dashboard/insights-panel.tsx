"use client"

import { useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingDown,
} from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { Insight, InsightCategory } from '@/lib/sales-intelligence/insights'
import { formatCurrency } from '@/lib/currency'
import { cn } from '@/lib/utils'
import { Skeleton } from './skeleton'
import { EmptyState } from './empty-state'

interface InsightsPanelProps {
  insights: Insight[] | null
  loading: boolean
  currency: string
  /** Popup variant (DailyReportDialog): shows at most COMPACT_LIMIT,
   *  no header chrome — the dialog supplies its own title. Full
   *  variant (/dashboard, /dashboard/informe): shows at most
   *  DISPLAY_LIMIT, with its own card header. */
  compact?: boolean
  /** When true, a "Ver más" control reveals every remaining insight
   *  instead of just hiding them past the initial limit — Centro de
   *  Decisiones passes this, since its intelligence engine
   *  deliberately returns everything it detects, uncapped (see
   *  buildInsights' own doc comment); the display limit is enforced
   *  HERE, not upstream, so callers that don't pass this (/dashboard,
   *  the daily report dialog) keep showing at most DISPLAY_LIMIT the
   *  exact same way they always have. */
  expandable?: boolean
}

const DISPLAY_LIMIT = 5
const COMPACT_LIMIT = 3

const CATEGORY_STYLE: Record<
  InsightCategory,
  { icon: typeof AlertTriangle; badge: string; row: string }
> = {
  attention: {
    icon: AlertTriangle,
    badge: 'bg-rose-500/15 text-rose-400',
    row: 'border-rose-500/25 bg-rose-500/[0.06] hover:border-rose-500/45 hover:bg-rose-500/10',
  },
  risk: {
    icon: TrendingDown,
    badge: 'bg-amber-400/15 text-amber-500',
    row: 'border-amber-400/25 bg-amber-400/[0.06] hover:border-amber-400/45 hover:bg-amber-400/10',
  },
  opportunity: {
    icon: Sparkles,
    badge: 'bg-emerald-500/15 text-emerald-500',
    row: 'border-emerald-500/25 bg-emerald-500/[0.06] hover:border-emerald-500/45 hover:bg-emerald-500/10',
  },
  recommendation: {
    icon: Target,
    badge: 'bg-primary/15 text-primary',
    row: 'border-primary/25 bg-primary/[0.06] hover:border-primary/45 hover:bg-primary/10',
  },
}

function actionHref(insight: Insight): string {
  switch (insight.action.kind) {
    case 'goToConversation':
      return `/inbox?c=${insight.action.conversationId}`
    case 'goToPipeline':
      return '/pipelines'
    case 'goToInbox':
    default:
      return '/inbox'
  }
}

/**
 * "Saleslid detectó" — the Intelligence Layer's insight feed. Renders
 * whatever `buildInsights` (src/lib/sales-intelligence/insights.ts)
 * already computed and ranked; this component's only job is turning
 * `{titleKey, descriptionKey, params}` into text (next-intl) and
 * `{action}` into a real link — no detection logic lives here.
 * Visual language (rose/amber/emerald row + badge, Link-wrapped row)
 * mirrors NextBestActionCard/AlertsCard exactly, so this reads as the
 * same product, not a bolted-on new panel.
 */
export function InsightsPanel({ insights, loading, currency, compact, expandable }: InsightsPanelProps) {
  const t = useTranslations('Dashboard.insights')
  const [expanded, setExpanded] = useState(false)
  const limit = compact ? COMPACT_LIMIT : DISPLAY_LIMIT
  const full = insights ?? []
  const shown = insights == null ? null : expanded ? full : full.slice(0, limit)
  const hiddenCount = shown ? full.length - shown.length : 0

  const body = (
    <>
      {loading || !shown ? (
        <div className="space-y-2">
          {Array.from({ length: compact ? 2 : 3 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        compact ? (
          <p className="text-sm text-muted-foreground">{t('allClear')}</p>
        ) : (
          <EmptyState icon={ShieldCheck} title={t('allClear')} />
        )
      ) : (
        <ul className="flex flex-col gap-1.5">
          {shown.map((insight, i) => {
            const style = CATEGORY_STYLE[insight.category]
            const Icon = style.icon
            return (
              <li key={`${insight.type}-${i}`}>
                <Link
                  href={actionHref(insight)}
                  className={cn(
                    'flex items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors',
                    style.row,
                  )}
                >
                  <span
                    className={cn(
                      'mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full',
                      style.badge,
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-foreground">
                      {t(insight.titleKey, insight.params)}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {t(insight.descriptionKey, insight.params)}
                    </span>
                  </span>
                  {insight.valueAtRisk != null && insight.valueAtRisk > 0 && (
                    <span className="shrink-0 text-xs font-semibold tabular-nums text-foreground">
                      {formatCurrency(insight.valueAtRisk, currency)}
                    </span>
                  )}
                </Link>
              </li>
            )
          })}
        </ul>
      )}
      {expandable && !loading && hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-2 w-full rounded-lg border border-dashed border-border px-3 py-2 text-center text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
        >
          {t('showMore', { count: hiddenCount })}
        </button>
      )}
    </>
  )

  if (compact) return <div className="space-y-2">{body}</div>

  return (
    <section className="flex h-full flex-col rounded-xl border border-border bg-card">
      <header className="flex items-center gap-2 border-b border-border px-5 py-4">
        <Sparkles className="h-4 w-4 text-primary" />
        <div>
          <h2 className="text-sm font-semibold text-foreground">{t('title')}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('subtitle')}</p>
        </div>
      </header>
      <div className="flex-1 p-4">{body}</div>
    </section>
  )
}
