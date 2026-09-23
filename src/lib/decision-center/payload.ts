import type { SupabaseClient } from '@supabase/supabase-js'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { cachedForAccount, CACHE_TTL } from '@/lib/cache/account-cache'
import { rangeForPreset, type PeriodRange } from '@/lib/period'
import {
  loadCeoMetrics,
  loadCeoAlerts,
  loadPeriodCommercialTrend,
  loadSellerPeriodPerformance,
  loadSalesFunnel,
  countHotLeadsUnanswered,
} from '@/lib/dashboard/ceo-queries'
import { loadNextBestActions, loadMoneyAtRisk, countOverduePromises } from '@/lib/sales-intelligence/queries'
import { loadRecoveryCandidates } from '@/lib/sales-intelligence/recovery'
import { buildInsights, type Insight } from '@/lib/sales-intelligence/insights'
import { buildDecisionActions, type DecisionAction } from '@/lib/sales-intelligence/decision-actions'
import { loadAiConfig } from '@/lib/ai/config'
import { logAiUsage } from '@/lib/ai/usage'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import type { DecisionCenterKpis } from './types'
import {
  buildInterpretationEvidence,
  buildDeterministicInterpretation,
  buildInterpretationRecommendation,
  generateExecutiveInterpretation,
  type InterpretationContext,
  type InterpretationMetric,
  type InterpretationRecommendation,
} from './interpretation'
import { computeStageDropoffs, biggestStageLeak, worstDecliningSeller, bestImprovingSeller } from './breakdown'

// Same default the ceo-summary route uses for the Alerts card and
// buildInsights — "Decisiones" is a CURRENT-STATE feed (stalled
// deals, forecast gap, broken promises...), not tied to the manager's
// KPI period selector, matching how AlertsCard/InsightsPanel already
// behave on /dashboard regardless of any date picker there. Also the
// window the interpretation's recommendation cites ("llevan más de N
// días sin avanzar").
const STALE_DAYS_DEFAULT = 7

export interface DecisionCenterPayload {
  range: { label: string; start: string; end: string }
  kpis: DecisionCenterKpis
  interpretation: string
  /** The full DATOS/COMPARACIÓN/CAMBIOS trail the interpretation
   *  paragraph and recommendation were built from — every KPI, not
   *  just the 1-2 headline ones cited in the prose. This is the "ver
   *  por qué" behind the interpretation, not a repeat of Section 1's
   *  cards: those show the numbers, this shows the REASONING (which
   *  ones moved, by how much, in which direction). */
  interpretationEvidence: InterpretationMetric[]
  /** "Qué hacer" tied directly to the interpretation — see
   *  interpretation.ts's own doc comment on why this is distinct
   *  from `todayPriorities` (individual lead-level actions) rather
   *  than a duplicate of it. Null only when nothing moved at all. */
  interpretationRecommendation: InterpretationRecommendation | null
  decisions: Insight[]
  /** One DecisionAction per `decisions` entry, same order — the seam
   *  a future Centro de Seguimiento will consume. Not rendered by
   *  any screen today; see decision-actions.ts's own doc comment. */
  decisionActions: DecisionAction[]
  todayPriorities: Awaited<ReturnType<typeof loadNextBestActions>>
  money: {
    atRisk: Awaited<ReturnType<typeof loadMoneyAtRisk>>
    recoveryOpportunities: Awaited<ReturnType<typeof loadRecoveryCandidates>>
    staleDays: number
  }
  breakdown: {
    bySeller: Awaited<ReturnType<typeof loadSellerPeriodPerformance>>
    worstDecliningSeller: ReturnType<typeof worstDecliningSeller>
    bestImprovingSeller: ReturnType<typeof bestImprovingSeller>
    stageDropoffs: ReturnType<typeof computeStageDropoffs>
    biggestLeakStage: ReturnType<typeof biggestStageLeak>
  }
}

/**
 * Everything Centro de Decisiones shows for one account+period,
 * assembled once and shared by both GET /api/manager/decision-center
 * (the page itself) and POST /api/manager/decision-center/ask
 * (Section 8, "Pregunta a Saleslid") — the Q&A snapshot is built from
 * this SAME object precisely so the assistant never answers with a
 * number the manager isn't also looking at on screen. Every cached
 * call here is keyed the same way regardless of caller, so a page
 * load and a question asked seconds later share the same cache entry
 * instead of doubling the query cost.
 *
 * `currency` is the caller's job to fetch (accounts.default_currency)
 * — this module has no opinion on where it comes from, only that the
 * interpretation/recommendation need it to cite real dollar amounts
 * ("$4,060 en 12 oportunidades estancadas") instead of only
 * percentages.
 */
export async function loadDecisionCenterPayload(
  supabase: SupabaseClient,
  accountId: string,
  userId: string,
  range: PeriodRange,
  currency: string,
): Promise<DecisionCenterPayload> {
  const rangeKey = `${range.start.toISOString()}:${range.end.toISOString()}`

  const getData = cachedForAccount(
    [accountId, 'decision-center-kpis', rangeKey],
    CACHE_TTL.decisionCenter,
    async () => {
      const [ceoMetrics, trend, bySeller] = await Promise.all([
        loadCeoMetrics(supabase, range),
        loadPeriodCommercialTrend(supabase, range),
        loadSellerPeriodPerformance(supabase, range),
      ])
      const kpis: DecisionCenterKpis = {
        sales: ceoMetrics.salesThisMonth,
        leads: ceoMetrics.newClients,
        conversion: trend.winRatePct,
        avgTicket: trend.avgTicket,
        opportunities: trend.opportunitiesCreated,
      }
      return {
        kpis,
        bySeller,
        worstDecliningSeller: worstDecliningSeller(bySeller),
        bestImprovingSeller: bestImprovingSeller(bySeller),
      }
    },
  )

  // Not period-dependent — its own cache entry, same TTL, computed
  // once per account regardless of which KPI period is selected.
  // Every input here is a function `/dashboard`'s "Saleslid detectó"
  // panel already calls; buildInsights just re-packages them (see its
  // own doc comment) into the 3-5 prioritized "Decisiones" the brief
  // asked for — no new detection logic, no new query beyond what
  // ceo-summary's route already assembles the same way.
  const getDecisions = cachedForAccount(
    [accountId, 'decision-center-decisions'],
    CACHE_TTL.decisionCenter,
    async () => {
      const thisMonthMetrics = await loadCeoMetrics(supabase, rangeForPreset('thisMonth'))
      const [alerts, hotUnanswered, nextBestActions, recoveryCandidates, overduePromiseCount] = await Promise.all([
        loadCeoAlerts(supabase, thisMonthMetrics, STALE_DAYS_DEFAULT),
        countHotLeadsUnanswered(supabase),
        loadNextBestActions(supabase, STALE_DAYS_DEFAULT),
        loadRecoveryCandidates(supabase),
        countOverduePromises(supabase),
      ])
      const decisions: Insight[] = buildInsights({
        alerts,
        hotUnanswered,
        nextBestActions,
        recovery: recoveryCandidates,
        staleDays: STALE_DAYS_DEFAULT,
        overduePromiseCount,
      })
      // recoveryCandidates and nextBestActions are both reused as-is
      // beyond buildInsights: Section 5 ("Dinero y oportunidades") gets
      // the full recovery list (buildInsights only surfaces the TOP
      // one as a 🟢 Oportunidad decision), and Section 7 ("Qué debería
      // hacer hoy") gets the full next-best-action list —
      // <NextBestActionCard />'s own doc comment already calls it
      // "Estas son las cosas que debes hacer hoy", so it's reused
      // directly instead of building a second "today" list.
      return { decisions, recoveryCandidates, nextBestActions }
    },
  )

  // Section 5 ("Dinero y oportunidades") — same stalled-deal total the
  // Alerts card already surfaces as one number, broken down by
  // seller/stage. Current-state, own cache entry (staleDays folds into
  // the key the same way ceo-summary's does).
  const getMoneyAtRisk = cachedForAccount(
    [accountId, 'decision-center-money-at-risk', String(STALE_DAYS_DEFAULT)],
    CACHE_TTL.decisionCenter,
    () => loadMoneyAtRisk(supabase, STALE_DAYS_DEFAULT),
  )

  // Funnel stage drop-off — like Decisiones, a current-state view of
  // the open pipeline (loadSalesFunnel's own fixed 90-day window, the
  // same one the /dashboard funnel widget already uses), not tied to
  // the manager's KPI period selector.
  const getFunnelBreakdown = cachedForAccount(
    [accountId, 'decision-center-funnel-breakdown'],
    CACHE_TTL.decisionCenter,
    async () => {
      const funnel = await loadSalesFunnel(supabase)
      const stageDropoffs = computeStageDropoffs(funnel.steps)
      return { stageDropoffs, biggestLeakStage: biggestStageLeak(stageDropoffs) }
    },
  )

  const [
    { kpis, bySeller, worstDecliningSeller: worstSeller, bestImprovingSeller: bestSeller },
    { decisions, recoveryCandidates, nextBestActions },
    funnelBreakdown,
    moneyAtRisk,
  ] = await Promise.all([getData(), getDecisions(), getFunnelBreakdown(), getMoneyAtRisk()])

  // Built AFTER the four calls above resolve, deliberately — unlike
  // the old version (interpretation built from KPIs alone), this one
  // can cite the SAME stalled-deal value and funnel leak stage
  // Sections 4/5 already show, so "las ventas bajaron" comes with
  // real evidence attached instead of being a bare percentage. Own
  // cache entry, period-scoped like the KPIs it's built from (its
  // AI-rewording call only fires on a cache miss, same discipline as
  // before).
  const getInterpretation = cachedForAccount(
    [accountId, 'decision-center-interpretation', rangeKey],
    CACHE_TTL.decisionCenter,
    async () => {
      const evidence = buildInterpretationEvidence(kpis)
      const interpretationCtx: InterpretationContext = {
        moneyAtRiskValue: moneyAtRisk.totalValue,
        moneyAtRiskCount: moneyAtRisk.totalCount,
        staleDays: STALE_DAYS_DEFAULT,
        biggestLeakStage: funnelBreakdown.biggestLeakStage,
        currency,
      }
      const deterministic = buildDeterministicInterpretation(evidence, range.label, interpretationCtx)
      let interpretation = deterministic

      // Rate-limit checks only run on a cache miss (this whole
      // function only runs then), so real request volume is far
      // below these budgets — see the RATE_LIMITS comments.
      const userLimit = checkRateLimit(`ai-decision-center:${userId}`, RATE_LIMITS.aiDecisionCenter)
      const accountLimit = checkRateLimit(
        `ai-decision-center-acct:${accountId}`,
        RATE_LIMITS.aiDecisionCenterAccount,
      )
      if (userLimit.success && accountLimit.success) {
        const config = await loadAiConfig(supabase, accountId, { requireActive: false }).catch((err) => {
          console.error('[decision-center] loadAiConfig error:', err)
          return null
        })
        if (config) {
          try {
            const { interpretation: aiText, usage } = await generateExecutiveInterpretation({
              config,
              metrics: evidence,
              deterministicVersion: deterministic,
              rangeLabel: range.label,
            })
            if (aiText) interpretation = aiText
            void logAiUsage(supabaseAdmin(), {
              accountId,
              conversationId: null,
              mode: 'decision_center_interpretation',
              provider: config.provider,
              model: config.model,
              usage,
            })
          } catch (err) {
            // AI wording is an enhancement, never a requirement — the
            // deterministic narrative already computed above ships
            // instead. Nothing here should ever 500 the page.
            console.error('[decision-center] AI interpretation failed, using deterministic version:', err)
          }
        }
      }

      return {
        interpretation,
        interpretationEvidence: evidence,
        interpretationRecommendation: buildInterpretationRecommendation(evidence, interpretationCtx),
      }
    },
  )

  const { interpretation, interpretationEvidence, interpretationRecommendation } = await getInterpretation()

  return {
    range: { label: range.label, start: range.start.toISOString(), end: range.end.toISOString() },
    kpis,
    interpretation,
    interpretationEvidence,
    interpretationRecommendation,
    decisions,
    decisionActions: buildDecisionActions(decisions),
    todayPriorities: nextBestActions,
    money: { atRisk: moneyAtRisk, recoveryOpportunities: recoveryCandidates, staleDays: STALE_DAYS_DEFAULT },
    breakdown: {
      bySeller,
      worstDecliningSeller: worstSeller,
      bestImprovingSeller: bestSeller,
      stageDropoffs: funnelBreakdown.stageDropoffs,
      biggestLeakStage: funnelBreakdown.biggestLeakStage,
    },
  }
}

export function parseDecisionCenterRange(searchParams: URLSearchParams): PeriodRange {
  const preset = (searchParams.get('preset') as PeriodRange['label'] | null) ?? 'last7Days'
  if (preset === 'custom') {
    const start = searchParams.get('start')
    const end = searchParams.get('end')
    if (start && end) {
      return rangeForPreset('custom', { start: new Date(start), end: new Date(end) })
    }
    return rangeForPreset('last7Days')
  }
  return rangeForPreset(preset)
}
