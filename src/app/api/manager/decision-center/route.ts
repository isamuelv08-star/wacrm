import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { cachedForAccount, CACHE_TTL } from '@/lib/cache/account-cache'
import { rangeForPreset, type PeriodPreset } from '@/lib/period'
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
import { loadAiConfig } from '@/lib/ai/config'
import { logAiUsage } from '@/lib/ai/usage'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import type { DecisionCenterKpis } from '@/lib/decision-center/types'
import {
  buildInterpretationEvidence,
  buildDeterministicInterpretation,
  generateExecutiveInterpretation,
} from '@/lib/decision-center/interpretation'
import {
  computeStageDropoffs,
  biggestStageLeak,
  worstDecliningSeller,
  bestImprovingSeller,
} from '@/lib/decision-center/breakdown'

// Same default the ceo-summary route uses for the Alerts card and
// buildInsights — "Decisiones" is a CURRENT-STATE feed (stalled
// deals, forecast gap, broken promises...), not tied to the manager's
// KPI period selector, matching how AlertsCard/InsightsPanel already
// behave on /dashboard regardless of any date picker there.
const STALE_DAYS_DEFAULT = 7

/**
 * GET /api/manager/decision-center?preset=last7Days[&start=...&end=...]
 *                                  (admin+)
 *
 * Backing data for Centro de Decisiones — a SEPARATE endpoint from
 * /api/dashboard/ceo-summary (not a mode of it): that route's cache
 * entries and permission-per-widget filtering exist for the plain
 * /dashboard page's own contract, and this page has a materially
 * different one (admin+ only, one period selector driving every
 * section, no per-widget dashboard_permissions to check — the whole
 * page is the permission boundary, enforced again here as defense in
 * depth alongside the page's own server-side gate).
 *
 * Built stage by stage alongside the page itself. This stage adds
 * `interpretation` (Section 2, "Interpretación ejecutiva") to the
 * `kpis` this endpoint already returned — see
 * src/lib/decision-center/interpretation.ts for how that narrative is
 * built: deterministically from the same KPIs, with AI used only to
 * rephrase it when the account has a provider configured. Later
 * stages add `decisions`, `breakdown`, `money`, `team`,
 * `todayPriorities` to this SAME response, reusing this same cached
 * call — see the Centro de Decisiones plan for the section order.
 */
export async function GET(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    const { searchParams } = new URL(request.url)
    const range = parseRange(searchParams)
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

        const evidence = buildInterpretationEvidence(kpis)
        const deterministic = buildDeterministicInterpretation(evidence, range.label)
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
              // AI wording is an enhancement, never a requirement —
              // the deterministic narrative already computed above
              // ships instead. Nothing here should ever 500 the page.
              console.error('[decision-center] AI interpretation failed, using deterministic version:', err)
            }
          }
        }

        return {
          kpis,
          interpretation,
          bySeller,
          worstDecliningSeller: worstDecliningSeller(bySeller),
          bestImprovingSeller: bestImprovingSeller(bySeller),
        }
      },
    )

    // Not period-dependent — its own cache entry, same TTL, computed
    // once per account regardless of which KPI period is selected.
    // Every input here is a function `/dashboard`'s "Saleslid detectó"
    // panel already calls; buildInsights just re-packages them (see
    // its own doc comment) into the 3-5 prioritized "Decisiones" the
    // brief asked for — no new detection logic, no new query beyond
    // what ceo-summary's route already assembles the same way.
    const getDecisions = cachedForAccount(
      [accountId, 'decision-center-decisions'],
      CACHE_TTL.decisionCenter,
      async () => {
        const thisMonthMetrics = await loadCeoMetrics(supabase, rangeForPreset('thisMonth'))
        const [alerts, hotUnanswered, nextBestActions, recoveryCandidates, overduePromiseCount] =
          await Promise.all([
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
        // recoveryCandidates is reused as-is for Section 5 ("Dinero y
        // oportunidades") — buildInsights only ever surfaces the TOP
        // one as a 🟢 Oportunidad decision; the full list belongs to
        // that section's <RecoveryCard />, same split ceo-summary's
        // response already keeps between `insights` and its other
        // sibling fields.
        return { decisions, recoveryCandidates }
      },
    )

    // Section 5 ("Dinero y oportunidades") — same stalled-deal total
    // the Alerts card already surfaces as one number, broken down by
    // seller/stage. Current-state, own cache entry (staleDays folds
    // into the key the same way ceo-summary's does).
    const getMoneyAtRisk = cachedForAccount(
      [accountId, 'decision-center-money-at-risk', String(STALE_DAYS_DEFAULT)],
      CACHE_TTL.decisionCenter,
      () => loadMoneyAtRisk(supabase, STALE_DAYS_DEFAULT),
    )

    // Funnel stage drop-off — like Decisiones, a current-state view of
    // the open pipeline (loadSalesFunnel's own fixed 90-day window,
    // the same one the /dashboard funnel widget already uses), not
    // tied to the manager's KPI period selector.
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
      {
        kpis,
        interpretation,
        bySeller,
        worstDecliningSeller: worstSeller,
        bestImprovingSeller: bestSeller,
      },
      { decisions, recoveryCandidates },
      funnelBreakdown,
      moneyAtRisk,
    ] = await Promise.all([getData(), getDecisions(), getFunnelBreakdown(), getMoneyAtRisk()])

    return NextResponse.json({
      range: { label: range.label, start: range.start.toISOString(), end: range.end.toISOString() },
      kpis,
      interpretation,
      decisions,
      money: { atRisk: moneyAtRisk, recoveryOpportunities: recoveryCandidates, staleDays: STALE_DAYS_DEFAULT },
      breakdown: {
        bySeller,
        worstDecliningSeller: worstSeller,
        bestImprovingSeller: bestSeller,
        stageDropoffs: funnelBreakdown.stageDropoffs,
        biggestLeakStage: funnelBreakdown.biggestLeakStage,
      },
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

function parseRange(searchParams: URLSearchParams) {
  const preset = (searchParams.get('preset') as PeriodPreset | null) ?? 'last7Days'
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
