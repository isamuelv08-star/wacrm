import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseAdmin } from './admin-client'
import { loadAiConfig } from './config'
import { buildConversationContext } from './context'
import { retrieveKnowledge } from './knowledge'
import { generateReply } from './generate'
import { buildSystemPrompt, splitReplyIntoMessages } from './defaults'
import { buildHandoffSummary } from './handoff'
import { ensureDealInQualifiedStage } from './lead-scoring'
import { applySalesActions, loadDealStageContext } from './sales-actions'
import { applyContactName } from './contact-actions'
import { applyScheduledEvent } from './scheduling-actions'
import { applySentMedia } from './media-actions'
import { buildCalendarContext } from './calendar-context'
import { describeNowInZone } from './timezone'
import { logAiUsage } from './usage'
import { latestUserMessage } from './query'
import { engineSendText, resolveSendContext } from '@/lib/flows/meta-send'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { pickRoundRobinAgent } from '@/lib/assignment/round-robin'
import { signalTyping } from '@/lib/whatsapp/typing-indicator'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// How long a dispatch waits, after its own eligibility checks pass and
// before it does anything expensive, to see whether a newer customer
// message beats it to the reply — see the debounce block in
// dispatchInboundToAiReply for the full reasoning. Override with
// AI_AUTOREPLY_DEBOUNCE_MS (tests set it to 0; an operator could tune
// the window without a code change).
function debounceMs(): number {
  const raw = Number(process.env.AI_AUTOREPLY_DEBOUNCE_MS)
  return Number.isFinite(raw) && raw >= 0 ? raw : 12_000
}

async function countCustomerMessages(db: SupabaseClient, conversationId: string): Promise<number> {
  const { count } = await db
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversationId)
    .eq('sender_type', 'customer')
  return count ?? 0
}

/**
 * Pause before sending the NEXT part of a split auto-reply, scaled to
 * that part's own length instead of a fixed delay — a two-word part
 * arriving after the same pause as a full sentence read as robotic.
 * Roughly half the previous pacing (was 900-3500ms, 50ms/char): still
 * enough of a beat that a multi-part reply doesn't read as one message
 * split for no reason, but a 3-part reply no longer adds up to ~7s of
 * pure waiting on top of the model's own latency.
 */
function typingDelayForPart(text: string): number {
  return Math.min(1800, Math.max(500, text.length * 25))
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
  // Diagnostic only — logs how long the dispatch spent on DB/knowledge
  // work vs. the provider call itself, so a "the AI replies too slowly"
  // report can be traced to a specific stage instead of guessed at.
  const dispatchStartedAt = Date.now()

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

    // Debounce: wait a bit before actually replying, so a customer who
    // sends several quick messages in a row (breaking one thought into
    // 2-3 bubbles) gets ONE reply covering all of them instead of the
    // bot answering the first fragment the instant it lands. Every
    // inbound message runs this same dispatch independently (one per
    // webhook delivery), so "wait, then check if a newer message beat
    // us to it" is what keeps that from turning into one reply PER
    // fragment: whichever delivery is the last to still see no newer
    // customer message once its own wait ends is the one that actually
    // replies; every earlier one quietly stands down.
    const customerMsgCountAtStart = await countCustomerMessages(db, conversationId)
    // Cosmetic, same fire-and-forget posture as every other signalTyping
    // call — shows "typing…" right away instead of the customer staring
    // at silence for the whole debounce window.
    void signalTyping(db, accountId, conversationId)
    await sleep(debounceMs())
    const customerMsgCountAfterWait = await countCustomerMessages(db, conversationId)
    if (customerMsgCountAfterWait > customerMsgCountAtStart) {
      return // a newer message arrived — its own dispatch will reply instead
    }

    // Account-wide throttle on the shared BYO key. The per-conversation
    // cap bounds one thread; this bounds a burst across many threads (a
    // marketing blast landing 200 replies at once) so we never run the
    // owner's key past the provider's rate limit. Over the limit → skip
    // the auto-reply; the inbound still sits in the inbox for a human.
    // Checked before any of the context-gathering below so a throttled
    // account doesn't pay for those reads either.
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

    // Every reply this account might be waiting on is gated on the LLM
    // call at the bottom of this function — every DB round trip before
    // it is pure added latency on top of that. None of these five reads
    // depend on each other's result (only `retrieveKnowledge` below
    // needs `messages`, which is why it isn't in this batch too), so
    // firing them together turns N sequential round trips into one.
    // The trade-off: on the rare conversation with zero text/audio/
    // image/video messages ever (so `messages` comes back empty and we
    // bail right after), the other four still ran for nothing — a cheap
    // price for cutting real latency on every reply that DOES send.
    const [messages, dealContext, accountRow, mediaItemsRes, contactRow] = await Promise.all([
      buildConversationContext(db, conversationId),
      // Deal + pipeline-stage context, needed regardless of sales mode:
      // it drives sales mode's [[STAGE:...]] protocol when enabled, AND
      // decides whether [[SUMMARY:...]] gets taught at all (only
      // meaningful with an open deal to attach it to). Two short
      // lookups; a no-op cost when there's no open deal either way.
      loadDealStageContext(db, { accountId, contactId }),
      // Only fetched when scheduling is actually on — an extra query on
      // every single auto-reply for accounts that never enabled it
      // would be pure waste.
      config.aiSchedulingEnabled
        ? db.from('accounts').select('timezone').eq('id', accountId).maybeSingle()
        : Promise.resolve({ data: null as { timezone: string } | null }),
      // Same "only when opted in" posture — an extra query per
      // auto-reply for accounts that never turned this on would be pure
      // waste. Empty catalog degrades to the same no-op as the switch
      // being off: buildSystemPrompt only adds the [[SEND_MEDIA:...]]
      // instruction when this array is non-empty.
      config.mediaSendingEnabled
        ? db.from('ai_media_library').select('key, description').eq('account_id', accountId)
        : Promise.resolve({ data: [] as { key: string; description: string }[] }),
      // Cheap, single-row lookup — worth doing on every auto-reply
      // (unlike the opt-in features above) since capturing a name is
      // basic lead intake, not an extra capability an account has to
      // turn on. Once a name is on file this stays false forever for
      // this contact, so the instruction (and this query) only ever
      // matters early in a lead's lifecycle.
      db.from('contacts').select('name').eq('id', contactId).maybeSingle(),
    ])
    if (messages.length === 0) return

    const accountTimezone = accountRow.data?.timezone ?? 'UTC'
    const mediaLibrary = mediaItemsRes.data ?? []
    const needsContactName = !contactRow.data?.name?.trim()

    // Knowledge retrieval (its own embeddings API call + one or two DB
    // RPCs) and the Google Calendar readout (an external API round
    // trip, opt-in) are independent of each other — run them together
    // rather than one after the other. calendarContext still needs
    // `accountTimezone` from the batch above, which is why it couldn't
    // join that Promise.all too.
    const [knowledge, calendarContext] = await Promise.all([
      // Ground the reply in the account's knowledge base (best-effort).
      retrieveKnowledge(db, accountId, config, latestUserMessage(messages)),
      config.aiSchedulingEnabled && config.googleCalendarSyncEnabled
        ? buildCalendarContext(db, accountId, accountTimezone)
        : Promise.resolve([]),
    ])

    const systemPrompt = buildSystemPrompt({
      userPrompt: config.systemPrompt,
      mode: 'auto_reply',
      knowledge,
      salesMode: config.salesModeEnabled
        ? { enabled: true, stages: dealContext.stages, currency: dealContext.currency }
        : null,
      hasOpenDeal: dealContext.hasOpenDeal,
      scheduling: config.aiSchedulingEnabled
        ? { enabled: true, nowLabel: describeNowInZone(accountTimezone) }
        : null,
      calendarContext,
      mediaLibrary,
      needsContactName,
    })

    // "Typing…" while the model generates — reads as someone actually
    // there instead of a reply that just appears the instant it's
    // ready. Fire-and-forget: never worth delaying (or failing) the
    // reply over a cosmetic touch.
    void signalTyping(db, accountId, conversationId)

    const {
      text,
      handoff,
      handoffSummary,
      stageMove,
      dealWon,
      dealLost,
      summary,
      schedule,
      sendMedia,
      contactName,
      dealValue,
      usage,
    } = await (async () => {
      const beforeLlm = Date.now()
      const result = await generateReply({ config, systemPrompt, messages })
      console.log(
        `[ai auto-reply] conversation ${conversationId}: provider call took ${Date.now() - beforeLlm}ms ` +
          `(${beforeLlm - dispatchStartedAt}ms of DB/knowledge work before it, ${Date.now() - dispatchStartedAt}ms total so far)`,
      )
      return result
    })()

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

    // Lead scoring no longer happens here — classifyLeadIfNeeded
    // (lead-classify.ts), called right after this dispatch from the
    // webhook processor, is now the single scoring path regardless of
    // auto-reply/provider. See its doc comment for why.

    // Independent of handoff/reply outcome — a handoff and a stage
    // move/close/summary can all be true
    // in the same turn ("customer confirmed the order AND wants a
    // human for delivery details"). applySalesActions owns its own
    // try/catch and never throws.
    if (stageMove || dealWon || dealLost || summary || dealValue != null) {
      await applySalesActions(db, {
        accountId,
        contactId,
        stageMove,
        dealWon,
        dealLost,
        summary,
        dealValue,
      })
    }

    // Independent of handoff/reply outcome, same as the blocks above —
    // a customer can state their name in the same turn the bot hands
    // off. applyContactName owns its own try/catch and never throws.
    if (contactName) {
      await applyContactName(db, { contactId, name: contactName })
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
        conversationId,
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
    // Resolved once and reused for every part — same contact, same
    // WhatsApp config either way, so there's no reason for parts 2 and 3
    // to redo the same contact + whatsapp_config lookups (and decrypt)
    // part 1 already did. See `resolveSendContext`'s doc comment.
    const parts = splitReplyIntoMessages(text)
    const sendContext = await resolveSendContext(db, accountId, contactId)
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
        resolved: sendContext,
      })
    }

    // Sent as a follow-up AFTER the text reply, same order a human
    // texting "sure, sending it now" then attaching the file would use.
    // applySentMedia owns its own try/catch and never throws.
    if (config.mediaSendingEnabled && sendMedia) {
      void signalTyping(db, accountId, conversationId)
      await applySentMedia(db, {
        accountId,
        conversationId,
        contactId,
        configOwnerUserId,
        key: sendMedia,
      })
    }
  } catch (err) {
    console.error('[ai auto-reply] dispatch failed:', err)
  }
}
