import type { FunnelStep } from '@/lib/dashboard/ceo-types'
import type { SellerPeriodPerformance } from '@/lib/dashboard/ceo-queries'

/**
 * Section 4 — "Dónde está cayendo el negocio": pure transforms over
 * data other functions already computed (loadSalesFunnel's steps,
 * loadSellerPeriodPerformance's per-member rows). No I/O, no new
 * detection thresholds — just picking out which stage/seller the
 * numbers already say is the problem.
 *
 * By-PRODUCT breakdown is deliberately not implemented — the user
 * approved leaving it out of Centro de Decisiones (no product/funnel
 * data model exists to aggregate against). By-SOURCE breakdown
 * (contact_custom_values' "Lead Source" field) is also left out of
 * this stage: it's the one genuine data-model gap this codebase's
 * audit already identified (no existing aggregate query groups by
 * source), so adding it here would mean inventing a new query under
 * time pressure rather than reusing one — worth a dedicated follow-up
 * stage rather than folding it into this one.
 */

export interface StageDropoff {
  fromKey: string
  fromLabel: string
  toKey: string
  toLabel: string
  fromCount: number
  toCount: number
  /** % of `fromCount` that never reached `toCount`. Null when the
   *  origin stage was empty — nothing to compute a drop rate from. */
  dropPct: number | null
}

/**
 * `loadSalesFunnel` (ceo-queries.ts) deliberately leaves `label: ''`
 * on its two synthetic steps (`key: 'leads'`, `key: 'won'`) — the
 * existing /dashboard funnel chart resolves those two through
 * `next-intl` by key instead (see sales-funnel.tsx:
 * `step.key === 'leads' ? t('leads') : step.key === 'won' ? t('won')
 * : step.label`). This module has no i18n context (it generates
 * plain Spanish text server-side, same convention as rules.ts), so it
 * resolves the same two keys to the exact same Spanish strings that
 * catalog already uses (`Dashboard.ceo.funnel.leads` /
 * `Dashboard.ceo.funnel.won`) instead of leaving them blank. A REAL
 * pipeline stage's `label` is never invented here — if one somehow
 * arrives empty (a data-integrity issue this function can't fix),
 * it falls back to an explicit "Sin etapa" rather than rendering
 * nothing, so a leak never reads as "entre 'Seguimiento' y ''".
 */
function resolveStageLabel(step: FunnelStep): string {
  if (step.key === 'leads') return 'Leads'
  if (step.key === 'won') return 'Ganadas'
  return step.label.trim() ? step.label : 'Sin etapa'
}

/** One entry per adjacent pair of funnel steps, in the funnel's own
 *  order (leads → ... → won). */
export function computeStageDropoffs(steps: FunnelStep[]): StageDropoff[] {
  const out: StageDropoff[] = []
  for (let i = 0; i < steps.length - 1; i++) {
    const from = steps[i]
    const to = steps[i + 1]
    out.push({
      fromKey: from.key,
      fromLabel: resolveStageLabel(from),
      toKey: to.key,
      toLabel: resolveStageLabel(to),
      fromCount: from.count,
      toCount: to.count,
      dropPct: from.count > 0 ? ((from.count - to.count) / from.count) * 100 : null,
    })
  }
  return out
}

/** The single adjacent-stage transition losing the highest share of
 *  leads — the one worth calling out, not a ranked list of all of
 *  them. Null when nothing is comparable (funnel too short, or every
 *  origin stage was empty). */
export function biggestStageLeak(dropoffs: StageDropoff[]): StageDropoff | null {
  const withDrop = dropoffs.filter((d): d is StageDropoff & { dropPct: number } => d.dropPct != null)
  if (withDrop.length === 0) return null
  return withDrop.reduce((worst, d) => (d.dropPct > worst.dropPct ? d : worst))
}

export type SellerWithWinRateDelta = SellerPeriodPerformance & { winRateDeltaPts: number }

function comparableSellers(sellers: SellerPeriodPerformance[]): SellerWithWinRateDelta[] {
  return sellers
    .filter((s) => s.winRateCurrent != null && s.winRatePrevious != null)
    .map((s) => ({ ...s, winRateDeltaPts: (s.winRateCurrent as number) - (s.winRatePrevious as number) }))
}

/** The seller whose win rate fell the most vs the previous period —
 *  the one row worth calling out on a page that lists 3-5 decisions,
 *  not a full leaderboard (the seller breakdown table already shows
 *  everyone). Only considers members with a rate on both sides of the
 *  comparison; a member with no closed deals in one half has nothing
 *  to compare, not a 0% rate. Null when no one is comparable, or when
 *  the biggest mover is actually an IMPROVEMENT (nothing falling to
 *  report). */
export function worstDecliningSeller(sellers: SellerPeriodPerformance[]): SellerWithWinRateDelta | null {
  const comparable = comparableSellers(sellers)
  if (comparable.length === 0) return null
  const worst = comparable.reduce((acc, s) => (s.winRateDeltaPts < acc.winRateDeltaPts ? s : acc))
  return worst.winRateDeltaPts < 0 ? worst : null
}

/** Mirror of `worstDecliningSeller` — the seller whose win rate rose
 *  the most, for the team performance table's "biggest improver"
 *  flag (spec section 6). Null when no one is comparable, or when the
 *  biggest mover actually declined (nothing improving to report). */
export function bestImprovingSeller(sellers: SellerPeriodPerformance[]): SellerWithWinRateDelta | null {
  const comparable = comparableSellers(sellers)
  if (comparable.length === 0) return null
  const best = comparable.reduce((acc, s) => (s.winRateDeltaPts > acc.winRateDeltaPts ? s : acc))
  return best.winRateDeltaPts > 0 ? best : null
}
