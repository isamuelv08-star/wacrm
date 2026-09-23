import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { cachedForAccount, CACHE_TTL } from '@/lib/cache/account-cache'
import { rangeForPreset, type PeriodPreset } from '@/lib/period'
import { loadCeoMetrics, loadPeriodCommercialTrend } from '@/lib/dashboard/ceo-queries'
import { loadAiConfig } from '@/lib/ai/config'
import { logAiUsage } from '@/lib/ai/usage'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import type { DecisionCenterKpis } from '@/lib/decision-center/types'
import {
  buildInterpretationEvidence,
  buildDeterministicInterpretation,
  generateExecutiveInterpretation,
} from '@/lib/decision-center/interpretation'

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
        const [ceoMetrics, trend] = await Promise.all([
          loadCeoMetrics(supabase, range),
          loadPeriodCommercialTrend(supabase, range),
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

        return { kpis, interpretation }
      },
    )

    const { kpis, interpretation } = await getData()

    return NextResponse.json({
      range: { label: range.label, start: range.start.toISOString(), end: range.end.toISOString() },
      kpis,
      interpretation,
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
