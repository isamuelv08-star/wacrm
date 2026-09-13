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
 * — the ONE scoring path, used identically whether auto-reply is on or
 * off and regardless of AI provider (migration 038's
 * `qualification_criteria`). Call unconditionally from the webhook
 * (same posture as `dispatchInboundToAiReply`): every eligibility gate
 * lives inside this function, and it never throws.
 *
 * Used to bail when auto-reply was ON, on the theory that
 * `dispatchInboundToAiReply` could ask the model to self-score in the
 * same completion as its reply (a trailing `[[SCORE:...]]` sentinel).
 * That turned out unreliable in practice — a reasoning-heavy model
 * (e.g. OpenAI's default) can burn its output budget before ever
 * reaching a tag appended after the customer-facing text, silently
 * dropping every score for that account. This dedicated JSON-only call
 * has no reply to interleave with and nothing else competing for its
 * output budget, so it doesn't have that failure mode — that's why
 * it's now the single source of truth for scoring in both modes. See
 * `buildSystemPrompt`'s auto_reply branch (defaults.ts), which no
 * longer teaches `[[SCORE:...]]` at all.
 */
export async function classifyLeadIfNeeded(args: ClassifyArgs): Promise<void> {
  const { accountId, conversationId, contactId, configOwnerUserId } = args

  try {
    const db = supabaseAdmin()

    const config = await loadAiConfig(db, accountId)
    if (!config) return
    if (!config.qualificationCriteria || !config.qualificationCriteria.trim()) return

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

    // Snapshot BEFORE the (slow) provider call — see the re-check right
    // after it for why. Missing row / column just means "no baseline
    // yet", never a reason to skip.
    const { data: beforeRow } = await db
      .from('contacts')
      .select('lead_score_assessed_at')
      .eq('id', contactId)
      .maybeSingle()
    const assessedAtBeforeCall = beforeRow?.lead_score_assessed_at ?? null

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

    // Same race this fixes for auto-reply's double-send bug: a customer
    // sending several messages in quick succession fires one
    // classifyLeadIfNeeded per inbound, each running its OWN provider
    // call independently and with no ordering guarantee between them.
    // Without this check, an EARLIER message's classification (built
    // from less conversation, arguably the less-informed verdict) can
    // finish AFTER a later message's and silently overwrite it — which
    // read as "the AI activity feed said HOT, but the contact's badge
    // never changed / went back to warm". Bail if a newer assessment
    // has already landed while this one's provider call was in flight.
    const { data: afterRow } = await db
      .from('contacts')
      .select('lead_score_assessed_at')
      .eq('id', contactId)
      .maybeSingle()
    if ((afterRow?.lead_score_assessed_at ?? null) !== assessedAtBeforeCall) {
      console.log(
        `[ai lead-classify] contact ${contactId}: a newer assessment landed while this one was in flight — standing down instead of overwriting it.`,
      )
      return
    }

    // Credit the conversation's assigned agent as the deal owner, if it
    // has one, instead of drawing a fresh round-robin pick — same
    // reasoning as ensureDealInQualifiedStage. Best-effort: a lookup
    // failure just means no preferred agent, not a blocked
    // classification.
    const { data: conv } = await db
      .from('conversations')
      .select('assigned_agent_id')
      .eq('id', conversationId)
      .maybeSingle()

    await applyLeadScore(db, {
      accountId,
      contactId,
      configOwnerUserId,
      score,
      reason,
      source: 'ai',
      preferredAgentUserId: conv?.assigned_agent_id ?? null,
      leadAutoAssignEnabled: config.leadAutoAssignEnabled,
      conversationId,
    })
  } catch (err) {
    console.error('[ai lead-classify] dispatch failed:', err)
  }
}
