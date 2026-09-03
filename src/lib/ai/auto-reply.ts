import { supabaseAdmin } from './admin-client'
import { loadAiConfig } from './config'
import { buildConversationContext } from './context'
import { retrieveKnowledge } from './knowledge'
import { generateReply } from './generate'
import { buildSystemPrompt, splitReplyIntoMessages } from './defaults'
import { buildHandoffSummary } from './handoff'
import { applyLeadScore, ensureDealInQualifiedStage } from './lead-scoring'
import { applySalesActions, loadDealStageContext } from './sales-actions'
import { applyScheduledEvent } from './scheduling-actions'
import { buildCalendarContext } from './calendar-context'
import { describeNowInZone } from './timezone'
import { logAiUsage } from './usage'
import { latestUserMessage } from './query'
import { engineSendText } from '@/lib/flows/meta-send'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { pickRoundRobinAgent } from '@/lib/assignment/round-robin'
import { signalTyping } from '@/lib/whatsapp/typing-indicator'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Pause before sending the NEXT part of a split auto-reply, scaled to
 * that part's own length instead of a fixed delay — a two-word part
 * arriving after the same pause as a full sentence read as robotic.
 * ~50ms/char (≈ 240 chars/min, an unhurried but real phone typing
 * speed) clamped so a short part still feels deliberate (never under
 * 900ms) and a long one doesn't stall the thread (never over 3500ms).
 */
function typingDelayForPart(text: string): number {
  return Math.min(3500, Math.max(900, text.length * 50))
}

interface DispatchArgs {
  /** Tenancy key — drives config, contact, and whatsapp_config lookups. */
  accountId: string
  conversationId: string
  contactId: string
  /** The account's WhatsApp config owner, used for the outbound send's
   *  audit columns (mirrors how the flow runner passes it through). */
  configOwnerUserId: string
}

/**
 * AI auto-reply for a freshly-arrived inbound message.
 *
 * Invoked from the WhatsApp webhook's `after()` block, only when no
 * deterministic flow consumed the message (flows win). Mirrors the flow
 * runner's contract: it owns its try/catch and NEVER throws — a failing
 * or slow LLM call must not affect the webhook's 200 to Meta.
 *
 * Eligibility gates (any → silent no-op):
 *   - AI off / auto-reply disabled for the account
 *   - a human agent is assigned (they own the thread)
 *   - auto-reply was disabled for this conversation (prior handoff)
 *   - the per-conversation reply cap is reached
 *   - there's nothing to reply to
 *
 * The 24h WhatsApp session window is inherently open here — we're
 * reacting to a customer message that just landed — so no separate
 * window check is needed.
 */
export async function dispatchInboundToAiReply(
  args: DispatchArgs,
): Promise<void> {
  const { accountId, conversationId, contactId, configOwnerUserId } = args

  try {
    const db = supabaseAdmin()

    const config = await loadAiConfig(db, accountId)
    if (!config || !config.autoReplyEnabled) return

    // Deterministic, user-configured responders win over the LLM — the
    // caller already excludes messages a Flow consumed. Message-level
    // automations (`new_message_received` / `keyword_match`) are
    // dispatched independently for this same inbound and may send their
    // own reply, so if the account has any active one we stand down to
    // avoid double-texting the customer. (Relationship triggers like
    // `first_inbound_message` don't count — they're not per-message
    // auto-responders.)
    const { data: autoResponders } = await db
      .from('automations')
      .select('id')
      .eq('account_id', accountId)
      .eq('is_active', true)
      .in('trigger_type', ['new_message_received', 'keyword_match'])
      .limit(1)
    if (autoResponders && autoResponders.length > 0) return

    const { data: conv, error: convErr } = await db
      .from('conversations')
      .select('assigned_agent_id, ai_autoreply_disabled, ai_reply_count')
      .eq('id', conversationId)
      .maybeSingle()
    if (convErr || !conv) return
    if (conv.assigned_agent_id) return // a human owns this thread
    if (conv.ai_autoreply_disabled) return // handed off / turned off here
    // Cheap early-out; the authoritative cap check is the atomic claim
    // below (this read can race a concurrent inbound). A null cap means
    // "never stop responding" (migration 047) — skip the check entirely.
    if (
      config.autoReplyMaxPerConversation !== null &&
      conv.ai_reply_count >= config.autoReplyMaxPerConversation
    )
      return

    const messages = await buildConversationContext(db, conversationId)
    if (messages.length === 0) return

    // Account-wide throttle on the shared BYO key. The per-conversation
    // cap bounds one thread; this bounds a burst across many threads (a
    // marketing blast landing 200 replies at once) so we never run the
    // owner's key past the provider's rate limit. Over the limit → skip
    // the auto-reply; the inbound still sits in the inbox for a human.
    const acctLimit = checkRateLimit(
      `ai-autoreply:${accountId}`,
      RATE_LIMITS.aiAutoReplyAccount,
    )
    if (!acctLimit.success) {
      console.warn(
        `[ai auto-reply] account ${accountId} hit the per-account rate limit — skipping this inbound.`,
      )
      return
    }

    // Ground the reply in the account's knowledge base (best-effort).
    const knowledge = await retrieveKnowledge(
      db,
      accountId,
      config,
      latestUserMessage(messages),
    )

    // Deal + pipeline-stage context, needed regardless of sales mode:
    // it drives sales mode's [[STAGE:...]] protocol when enabled, AND
    // decides whether [[SUMMARY:...]] gets taught at all (only
    // meaningful with an open deal to attach it to). Two short
    // lookups; a no-op cost when there's no open deal either way.
    const dealContext = await loadDealStageContext(db, { accountId, contactId })

    // Only fetched when scheduling is actually on — an extra query on
    // every single auto-reply for accounts that never enabled it would
    // be pure waste.
    let accountTimezone = 'UTC'
    if (config.aiSchedulingEnabled) {
      const { data: acct } = await db
        .from('accounts')
        .select('timezone')
        .eq('id', accountId)
        .maybeSingle()
      accountTimezone = acct?.timezone ?? 'UTC'
    }

    // Same "only when actually opted in" posture as the timezone
    // lookup above — an extra Google API round trip on every
    // auto-reply for accounts that never turned this on would be
    // pure waste (and pure added latency on the customer-facing send).
    const calendarContext =
      config.aiSchedulingEnabled && config.googleCalendarSyncEnabled
        ? await buildCalendarContext(db, accountId, accountTimezone)
        : []

    const systemPrompt = buildSystemPrompt({
      userPrompt: config.systemPrompt,
      mode: 'auto_reply',
      knowledge,
      qualificationCriteria: config.qualificationCriteria,
      salesMode: config.salesModeEnabled
        ? { enabled: true, stages: dealContext.stages }
        : null,
      hasOpenDeal: dealContext.hasOpenDeal,
      scheduling: config.aiSchedulingEnabled
        ? { enabled: true, nowLabel: describeNowInZone(accountTimezone) }
        : null,
      calendarContext,
    })

    // "Typing…" while the model generates — reads as someone actually
    // there instead of a reply that just appears the instant it's
    // ready. Fire-and-forget: never worth delaying (or failing) the
    // reply over a cosmetic touch.
    void signalTyping(db, accountId, conversationId)

    const {
      text,
      handoff,
      score,
      scoreReason,
      handoffSummary,
      stageMove,
      dealWon,
      dealLost,
      summary,
      schedule,
      usage,
    } = await generateReply({
      config,
      systemPrompt,
      messages,
    })

    // Record token spend on the account's BYO key. Fire-and-forget so it
    // never adds latency to the customer-facing send: `logAiUsage`
    // swallows its own errors, so the floating promise can't reject.
    // Logged regardless of handoff — the provider call happened either
    // way.
    void logAiUsage(db, {
      accountId,
      conversationId,
      mode: 'auto_reply',
      provider: config.provider,
      model: config.model,
      usage,
    })

    // Independent of handoff/reply outcome below — the model can score
    // a lead HOT in the same turn it hands off ("customer wants a
    // human AND clearly has budget + urgency"). applyLeadScore owns
    // its own try/catch and never throws.
    if (score) {
      await applyLeadScore(db, {
        accountId,
        contactId,
        configOwnerUserId,
        score,
        reason: scoreReason,
        source: 'ai',
        preferredAgentUserId: conv.assigned_agent_id,
        leadAutoAssignEnabled: config.leadAutoAssignEnabled,
      })
    }

    // Same "independent of handoff/reply outcome" posture as the score
    // above — a handoff and a stage move/close/summary can all be true
    // in the same turn ("customer confirmed the order AND wants a
    // human for delivery details"). applySalesActions owns its own
    // try/catch and never throws.
    if (stageMove || dealWon || dealLost || summary) {
      await applySalesActions(db, {
        accountId,
        contactId,
        stageMove,
        dealWon,
        dealLost,
        summary,
      })
    }

    // Same "independent of handoff/reply outcome" posture as the two
    // blocks above — a handoff and a fresh appointment/callback commitment
    // can land in the same turn ("I'll have someone call you tomorrow at
    // 10 to sort out delivery"). applyScheduledEvent owns its own
    // try/catch and never throws.
    if (config.aiSchedulingEnabled && schedule) {
      await applyScheduledEvent(db, {
        accountId,
        contactId,
        configOwnerUserId,
        handoffAgentId: config.handoffAgentId,
        timezone: accountTimezone,
        localDateTime: schedule.localDateTime,
        type: schedule.type,
        title: schedule.title,
        googleCalendarSyncEnabled: config.googleCalendarSyncEnabled,
      })
    }

    if (handoff || !text) {
      // The model can't (or shouldn't) answer — stop auto-replying on
      // this thread and hand it to a human. We (a) pause the bot here
      // (sticky until re-enabled), (b) route the conversation to the
      // configured handoff agent — null leaves it in the shared queue —
      // and (c) leave an internal note so whoever picks it up has
      // context. Assigning fires the `on_conversation_assigned` trigger,
      // which notifies the agent (and, per migration 042, mirrors a
      // short excerpt of this note into the notification body).
      //
      // Prefer the model's own [[HANDOFF_SUMMARY:...]] note — it can
      // speak to what the customer actually needs, not just quote their
      // last message — and fall back to the deterministic note when the
      // model handed off without one (e.g. the `!text` bail-out path,
      // which never asked for a summary, or a model that didn't comply).
      const summary =
        handoffSummary ??
        buildHandoffSummary({
          messages,
          replyCount: conv.ai_reply_count ?? 0,
        })
      const update: Record<string, unknown> = {
        ai_autoreply_disabled: true,
        ai_handoff_summary: summary,
        // Marks this as an AI-initiated pause — the sole signal the
        // opt-in auto-resume scan (lib/ai/auto-resume.ts) trusts. Any
        // explicit human action through the inbox toggle clears it, so
        // auto-resume can never override a human who actually engaged.
        ai_paused_at: new Date().toISOString(),
      }
      // Only set the assignee when the thread isn't already owned —
      // never stomp an existing human assignment. A fixed
      // handoff_agent_id (account setting) wins when configured;
      // otherwise fall back to the same round-robin pool/cursor new
      // leads use, so a handoff is never left in the shared queue
      // just because the account didn't pin a specific agent.
      let targetAgentId: string | null = null
      if (!conv.assigned_agent_id) {
        targetAgentId = config.handoffAgentId ?? (await pickRoundRobinAgent(db, accountId))
        if (targetAgentId) update.assigned_agent_id = targetAgentId
      }
      await db.from('conversations').update(update).eq('id', conversationId)

      // A human being needed now is itself a qualification signal —
      // move the deal to the account's qualified pipeline stage
      // regardless of whether the model also scored this lead HOT this
      // turn (the score branch above already calls this for HOT; the
      // call is idempotent, so doing it again here is harmless). Credit
      // whoever the conversation just landed with (fresh handoff pick,
      // or an existing handler) as the deal owner too, ahead of drawing
      // a separate round-robin pick — see ensureDealInQualifiedStage's
      // doc comment.
      await ensureDealInQualifiedStage(db, {
        accountId,
        contactId,
        configOwnerUserId,
        preferredAgentUserId: targetAgentId ?? conv.assigned_agent_id,
        leadAutoAssignEnabled: config.leadAutoAssignEnabled,
      })

      return
    }

    // Atomically claim a reply slot: the cap check + increment happen in
    // one UPDATE, so concurrent inbounds can never overshoot the cap. If
    // another inbound just took the last slot, `claimed` is false and we
    // skip the send. (We consume a slot slightly before the send lands —
    // fail-safe: under-reply rather than over-reply.)
    const { data: claimed, error: claimErr } = await db.rpc(
      'claim_ai_reply_slot',
      {
        conversation_id: conversationId,
        max_replies: config.autoReplyMaxPerConversation,
      },
    )
    if (claimErr) {
      // A real error here (vs. losing the cap race) is almost always a
      // deploy issue — e.g. `claim_ai_reply_slot` not EXECUTE-able by the
      // service role, or the migration not applied. Log it loudly: a
      // silent return makes "auto-reply never fires" undiagnosable.
      console.error('[ai auto-reply] claim_ai_reply_slot failed:', claimErr)
      return
    }
    if (claimed !== true) return // lost the per-conversation cap race

    // Sent as separate consecutive messages (up to MAX_REPLY_PARTS) rather
    // than one block, with a short pause in between — closer to how a
    // person actually texts than a single wall of text arriving at once.
    const parts = splitReplyIntoMessages(text)
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) {
        // Sending a message clears the platform's typing bubble, so
        // it needs to be re-signaled for every part after the first —
        // otherwise only the opening part looks "typed."
        void signalTyping(db, accountId, conversationId)
        await sleep(typingDelayForPart(parts[i]))
      }
      await engineSendText({
        accountId,
        userId: configOwnerUserId,
        conversationId,
        contactId,
        text: parts[i],
        aiGenerated: true,
      })
    }
  } catch (err) {
    console.error('[ai auto-reply] dispatch failed:', err)
  }
}
