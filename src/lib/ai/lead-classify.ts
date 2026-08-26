import { supabaseAdmin } from './admin-client'
import { loadAiConfig } from './config'
import { buildConversationContext } from './context'
import { buildClassificationPrompt } from './defaults'
import { generateClassification } from './generate'
import { applyLeadScore } from './lead-scoring'
import { logAiUsage } from './usage'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'

interface ClassifyArgs {
  accountId: string
  conversationId: string
  contactId: string
  /** Passed straight through to `applyLeadScore` — see its own doc
   *  comment (mirrors how the flow runner / auto-reply pass it). */
  configOwnerUserId: string
}

/**
 * Standalone lead classification for a freshly-arrived inbound message
 * — runs independent of the auto-reply bot, so `qualification_criteria`
 * (migration 038) isn't silently inert for any account that keeps a
 * human writing replies ("draft" mode) instead of enabling full
 * auto-reply. Call unconditionally from the webhook (same posture as
 * `dispatchInboundToAiReply`): every eligibility gate lives inside this
 * function, and it never throws.
 *
 * Deliberately bails when auto-reply is ON: `dispatchInboundToAiReply`
 * already asks the model to score this same turn (via the
 * `[[SCORE:...]]` sentinel in its one combined reply-generation call),
 * so classifying here too would just be a second, redundant LLM call
 * for the same verdict.
 */
export async function classifyLeadIfNeeded(args: ClassifyArgs): Promise<void> {
  const { accountId, conversationId, contactId, configOwnerUserId } = args

  try {
    const db = supabaseAdmin()

    const config = await loadAiConfig(db, accountId)
    if (!config) return
    if (!config.qualificationCriteria || !config.qualificationCriteria.trim()) return
    if (config.autoReplyEnabled) return // already scored by the auto-reply call this turn

    const acctLimit = checkRateLimit(
      `ai-classify:${accountId}`,
      RATE_LIMITS.aiClassifyAccount,
    )
    if (!acctLimit.success) {
      console.warn(
        `[ai lead-classify] account ${accountId} hit the per-account rate limit — skipping this inbound.`,
      )
      return
    }

    const messages = await buildConversationContext(db, conversationId)
    if (messages.length === 0) return

    const systemPrompt = buildClassificationPrompt({
      userPrompt: config.systemPrompt,
      qualificationCriteria: config.qualificationCriteria,
    })

    const { score, reason, usage } = await generateClassification({
      config,
      systemPrompt,
      messages,
    })

    void logAiUsage(db, {
      accountId,
      conversationId,
      mode: 'classify',
      provider: config.provider,
      model: config.model,
      usage,
    })

    if (!score) return // model had nothing new/confident to assess this turn

    await applyLeadScore(db, {
      accountId,
      contactId,
      configOwnerUserId,
      score,
      reason,
      source: 'ai',
    })
  } catch (err) {
    console.error('[ai lead-classify] dispatch failed:', err)
  }
}
