import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { loadDecisionCenterPayload, parseDecisionCenterRange } from '@/lib/decision-center/payload'
import { buildDecisionCenterSnapshot, generateDecisionCenterAnswer } from '@/lib/decision-center/assistant'
import { loadAiConfig } from '@/lib/ai/config'
import { logAiUsage } from '@/lib/ai/usage'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { AiError } from '@/lib/ai/types'
import { DEFAULT_CURRENCY } from '@/lib/currency'

const MAX_QUESTION_LENGTH = 500

/**
 * POST /api/manager/decision-center/ask?preset=last7Days[&start=...&end=...]
 *                                       (admin+)
 *
 * Body: { question: string }
 * Returns: { answer: string, evidence: string[], recommendation: string|null }
 *
 * Section 8, "Pregunta a Saleslid". Deliberately a real-time call
 * every time (no deterministic fallback, unlike the interpretation
 * section) — there's no sensible non-AI answer to a free-text
 * question, so when no provider is configured this returns the same
 * `ai_not_configured` shape /api/ai/assistant already uses instead of
 * guessing at an answer.
 *
 * The snapshot the model answers from is built from
 * loadDecisionCenterPayload — the EXACT same cached data GET
 * /api/manager/decision-center returns for this account+period, never
 * a second independent query. That's what keeps the answer honest:
 * it can only ever cite a number the manager is already looking at.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId, account } = await requireRole('admin')

    const userLimit = checkRateLimit(`ai-decision-center-ask:${userId}`, RATE_LIMITS.aiDecisionCenterAsk)
    if (!userLimit.success) return rateLimitResponse(userLimit)
    const accountLimit = checkRateLimit(
      `ai-decision-center-ask-acct:${accountId}`,
      RATE_LIMITS.aiDecisionCenterAskAccount,
    )
    if (!accountLimit.success) return rateLimitResponse(accountLimit)

    const body = await request.json().catch(() => null)
    const question = typeof body?.question === 'string' ? body.question.trim() : ''
    if (!question) {
      return NextResponse.json({ error: 'question is required' }, { status: 400 })
    }
    if (question.length > MAX_QUESTION_LENGTH) {
      return NextResponse.json({ error: 'Question is too long.', code: 'question_too_long' }, { status: 400 })
    }

    const config = await loadAiConfig(supabase, accountId, { requireActive: false }).catch((err) => {
      console.error('[decision-center ask] loadAiConfig error:', err)
      throw new AiError('Stored API key could not be decrypted.', {
        code: 'key_decrypt_failed',
        status: 400,
      })
    })
    if (!config) {
      return NextResponse.json(
        {
          error: 'No AI provider configured yet. Add your API key in Settings.',
          code: 'ai_not_configured',
        },
        { status: 400 },
      )
    }

    const { searchParams } = new URL(request.url)
    const range = parseDecisionCenterRange(searchParams)
    const [payload, currencyRow] = await Promise.all([
      loadDecisionCenterPayload(supabase, accountId, userId, range),
      supabase.from('accounts').select('default_currency').eq('id', accountId).maybeSingle(),
    ])
    const currency = (currencyRow.data as { default_currency: string } | null)?.default_currency ?? DEFAULT_CURRENCY
    const snapshot = buildDecisionCenterSnapshot(payload, currency)

    const { result, usage } = await generateDecisionCenterAnswer({
      config,
      accountName: account.name,
      snapshot,
      question,
    })

    void logAiUsage(supabaseAdmin(), {
      accountId,
      conversationId: null,
      mode: 'decision_center_ask',
      provider: config.provider,
      model: config.model,
      usage,
    })

    if (!result) {
      return NextResponse.json(
        { error: 'The AI returned an unusable answer. Try again.', code: 'bad_response' },
        { status: 502 },
      )
    }

    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof AiError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status })
    }
    return toErrorResponse(err)
  }
}
