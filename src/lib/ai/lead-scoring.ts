import type { SupabaseClient } from '@supabase/supabase-js'
import type { LeadScore } from './types'
import { resolveProfileId } from './profile-id'
import { pickRoundRobinAgent } from '@/lib/assignment/round-robin'
import { logAiActivity } from './activity-log'
import { ensureOpenDeal } from '@/lib/deals/dedupe-open-deal'

// ============================================================
// Apply a lead score — either the AI emitted via the `[[SCORE:...]]`
// sentinel / the standalone classifier's JSON verdict (see defaults.ts
// / generate.ts / lead-classify.ts), or a human agent's manual
// override (source: 'manual').
//
// Two independent effects, both best-effort — a failure here must
// never take down the customer-facing reply that already sent:
//   1. Always persist the score (+ reason/source) onto `contacts`,
//      and stamp `lead_score_assessed_at` unconditionally (migration
//      064) — every call is a real assessment, value-changed or not,
//      which is what a "leads qualified today" dashboard count needs.
//      `lead_score_updated_at` and the `lead_score_history` audit row
//      are maintained separately by the `on_lead_score_change` DB
//      trigger (migration 061), which only fires on a real value
//      change — never set those from application code, so every
//      write path (this function, or any future one) stays correct
//      for free.
//   2. Only for HOT: advance the contact's deal to the qualified
//      stage via `ensureDealInQualifiedStage` below.
//
// Silently no-ops (with a log) wherever the account hasn't finished
// configuring this: no pipeline yet, or a pipeline with no stage
// marked as qualified.
// ============================================================
export async function applyLeadScore(
  db: SupabaseClient,
  args: {
    accountId: string
    contactId: string
    configOwnerUserId: string
    score: LeadScore
    /** Short explanation for this score, shown as a tooltip on the
     *  badge. Null when the caller has none (e.g. a manual override
     *  with no reason typed in). */
    reason?: string | null
    /** Who set this score — defaults to 'ai' (every existing caller is
     *  the AI bot); a manual-override endpoint passes 'manual'. */
    source?: 'ai' | 'manual'
    /** The conversation's current human handler (auth.users.id), if
     *  any — passed through to `ensureDealInQualifiedStage` so a deal
     *  reaching the qualified stage on a thread a human already owns
     *  is credited to that same person instead of drawing a fresh
     *  round-robin pick. */
    preferredAgentUserId?: string | null
    /** Account's lead-auto-assign toggle (`ai_configs.lead_auto_assign_enabled`).
     *  See `ensureDealInQualifiedStage`. */
    leadAutoAssignEnabled?: boolean
    /** Conversation this assessment happened in, if any — drives the
     *  inline "AI activity" pill (migration 075) and is forwarded to
     *  `ensureDealInQualifiedStage` for the same purpose. Omitted by
     *  the manual-override route, which has no single conversation to
     *  anchor a badge change to. */
    conversationId?: string | null
    /** Client for the deal-side effects (qualified-stage advance). The
     *  manual-override route writes the score with its RLS client (so
     *  lead_score_history attributes the change) but must create/move
     *  the deal with the service-role client — ensure_open_deal
     *  (migration 110) isn't executable by `authenticated`. Defaults
     *  to `db`. */
    dealDb?: SupabaseClient
  },
): Promise<void> {
  const {
    accountId,
    contactId,
    configOwnerUserId,
    score,
    reason = null,
    source = 'ai',
    preferredAgentUserId = null,
    leadAutoAssignEnabled = false,
    conversationId = null,
    dealDb = db,
  } = args

  try {
    // Read the score BEFORE overwriting it so we can tell whether this
    // call actually changed anything — the AI re-asserting the same
    // score turn after turn on an ongoing HOT lead shouldn't spam the
    // activity feed with a duplicate pill every time.
    const { data: before } = await db
      .from('contacts')
      .select('lead_score, lead_score_source, lead_score_updated_at')
      .eq('id', contactId)
      .maybeSingle()
    const previousScore = (before?.lead_score as LeadScore | null) ?? null

    // A rep's manual correction wins over the AI for a while — the
    // classifier runs on every inbound and used to overwrite it on the
    // very next message (and, if it said HOT, move the deal too).
    if (source === 'ai' && before?.lead_score_source === 'manual') {
      const setAt = before.lead_score_updated_at ? Date.parse(before.lead_score_updated_at) : NaN
      if (Number.isFinite(setAt) && Date.now() - setAt < MANUAL_SCORE_HOLD_MS) return
    }

    const { error: scoreErr } = await db
      .from('contacts')
      .update({
        lead_score: score,
        lead_score_reason: reason,
        lead_score_source: source,
        lead_score_assessed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', contactId)
      .eq('account_id', accountId)
    if (scoreErr) {
      console.error('[ai lead-scoring] failed to persist lead_score:', scoreErr.message)
    } else if (source === 'ai' && score !== previousScore) {
      await logAiActivity(db, {
        accountId,
        conversationId,
        contactId,
        eventType: 'lead_scored',
        payload: { score },
      })
    }

    if (score !== 'hot') return // only HOT advances the deal — see applyLeadScore's doc comment

    await ensureDealInQualifiedStage(dealDb, {
      accountId,
      contactId,
      configOwnerUserId,
      preferredAgentUserId,
      leadAutoAssignEnabled,
      conversationId,
    })
  } catch (err) {
    console.error('[ai lead-scoring] applyLeadScore failed:', err)
  }
}

/** How long a manual score override is protected from AI re-scoring. */
const MANUAL_SCORE_HOLD_MS = 7 * 24 * 60 * 60 * 1000

// ============================================================
// Advance the contact's open deal to whichever stage the account has
// designated "the qualified stage" for that deal's pipeline
// (pipeline_stages.is_qualified_stage, migration 038). If the contact
// has no open deal, one is created directly in the qualified stage —
// mirrors webhook-processor.ts's ensureLeadDeal, except targeting the
// qualified stage instead of the first one, since a lead reaching
// this point (HOT score, or an AI handoff — migration 042 / Fase A)
// should never sit unqualified just because it's the first time we're
// tracking it.
//
// Best-effort and idempotent (a no-op if the deal is already there) —
// safe to call once per HOT score AND once per handoff on the same
// turn without double-creating or double-moving anything.
//
// Also resolves the deal's OWNER (`deals.assigned_to`) whenever it's
// still unset — never overwrites an existing one, so this only ever
// fills a gap, never reassigns. `preferredAgentUserId` (the thread's
// current human handler, if any) always wins over a fresh pick, so a
// handoff and a HOT score landing in the same turn credit the same
// person instead of racing two independent round-robin draws. With no
// preferred agent, a pick is only drawn when `leadAutoAssignEnabled`
// is on (`ai_configs.lead_auto_assign_enabled`) — off by default, so
// accounts that never opted in see no behavior change. This never
// touches `conversations.assigned_agent_id`: the deal owner and the
// conversation's human handler are intentionally separate (see
// migration 069's doc comment) so the AI keeps replying — including
// driving a deal through sales mode end-to-end — even after a lead
// gets an owner here.
// ============================================================
export async function ensureDealInQualifiedStage(
  db: SupabaseClient,
  args: {
    accountId: string
    contactId: string
    configOwnerUserId: string
    preferredAgentUserId?: string | null
    leadAutoAssignEnabled?: boolean
    /** Conversation this qualification happened in, if any — drives the
     *  inline "AI activity" pill (migration 075) and is stamped on a
     *  newly created deal. See applyLeadScore's matching parameter. */
    conversationId?: string | null
  },
): Promise<void> {
  const {
    accountId,
    contactId,
    configOwnerUserId,
    preferredAgentUserId = null,
    leadAutoAssignEnabled = false,
    conversationId = null,
  } = args

  try {
    const { data: openDeal, error: dealErr } = await db
      .from('deals')
      .select('id, pipeline_id, stage_id, assigned_to')
      .eq('contact_id', contactId)
      .eq('account_id', accountId)
      .eq('status', 'open')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (dealErr) {
      console.error('[ai lead-scoring] open-deal lookup failed:', dealErr.message)
      return
    }

    if (openDeal) {
      await advanceOpenDealToQualified(db, openDeal, {
        accountId,
        contactId,
        preferredAgentUserId,
        leadAutoAssignEnabled,
        conversationId,
      })
      return
    }

    // No open deal. If one just closed (won/lost), this HOT verdict or
    // handoff is about THAT sale ("ya pagué, quiero hablar con alguien")
    // — creating a fresh card here left a phantom open deal in
    // Qualified next to the won one.
    const graceSince = new Date(Date.now() - CLOSED_DEAL_GRACE_MS).toISOString()
    const { data: recentlyClosed, error: closedErr } = await db
      .from('deals')
      .select('id')
      .eq('contact_id', contactId)
      .eq('account_id', accountId)
      .in('status', ['won', 'lost'])
      .gte('closed_at', graceSince)
      .limit(1)
      .maybeSingle()
    if (closedErr) {
      console.error('[ai lead-scoring] closed-deal lookup failed:', closedErr.message)
      return
    }
    if (recentlyClosed) return

    // Same "first pipeline by created_at" convention as ensureLeadDeal,
    // but land straight in the qualified stage.
    const { data: pipeline, error: pipelineErr } = await db
      .from('pipelines')
      .select('id')
      .eq('account_id', accountId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (pipelineErr) {
      console.error('[ai lead-scoring] pipeline lookup failed:', pipelineErr.message)
      return
    }
    if (!pipeline) {
      console.warn('[ai lead-scoring] account has no pipeline yet — skipping deal creation')
      return
    }

    const qualifiedStageId = await findQualifiedStageId(db, pipeline.id)
    if (!qualifiedStageId) {
      console.warn(
        `[ai lead-scoring] pipeline ${pipeline.id} has no stage marked as qualified — skipping deal creation`,
      )
      return
    }

    const { data: contact, error: contactErr } = await db
      .from('contacts')
      .select('name, phone')
      .eq('id', contactId)
      .maybeSingle()
    if (contactErr || !contact) {
      console.error('[ai lead-scoring] contact lookup failed:', contactErr?.message)
      return
    }

    const [{ data: acct }, ownerProfileId] = await Promise.all([
      db.from('accounts').select('default_currency').eq('id', accountId).maybeSingle(),
      resolveDealOwnerProfileId(db, { accountId, preferredAgentUserId, leadAutoAssignEnabled }),
    ])

    // Atomic per contact (migration 110). If the webhook's ensureLeadDeal
    // won the race, we get ITS deal back and advance that one instead.
    const result = await ensureOpenDeal(db, {
      accountId,
      contactId,
      userId: configOwnerUserId,
      pipelineId: pipeline.id,
      stageId: qualifiedStageId,
      conversationId,
      title: contact.name || contact.phone,
      currency: acct?.default_currency ?? 'USD',
      assignedTo: ownerProfileId,
    })
    if (!result) return

    if (result.created) {
      await logAiActivity(db, {
        accountId,
        conversationId,
        contactId,
        eventType: 'lead_qualified',
      })
      return
    }

    const { data: raced } = await db
      .from('deals')
      .select('id, pipeline_id, stage_id, assigned_to')
      .eq('id', result.dealId)
      .maybeSingle()
    if (raced) {
      await advanceOpenDealToQualified(db, raced, {
        accountId,
        contactId,
        preferredAgentUserId,
        leadAutoAssignEnabled,
        conversationId,
      })
    }
  } catch (err) {
    console.error('[ai lead-scoring] ensureDealInQualifiedStage failed:', err)
  }
}

/** See the grace-period comment in ensureDealInQualifiedStage. */
const CLOSED_DEAL_GRACE_MS = 3 * 24 * 60 * 60 * 1000

/**
 * Move an open deal FORWARD to the qualified stage and fill in a
 * missing owner. Forward-only: a deal already past qualified
 * (Proposal, Negotiation — moved there by the AI's sales mode or by a
 * rep) stays put; before this, every HOT re-score yanked it back to
 * Qualified and re-fired the "Lead qualified" notification. The one
 * exception is the follow-up stage, which sits at the END of the
 * pipeline by position but means "went quiet" — a HOT lead coming back
 * from it does move to Qualified.
 */
async function advanceOpenDealToQualified(
  db: SupabaseClient,
  deal: { id: string; pipeline_id: string; stage_id: string; assigned_to: string | null },
  args: {
    accountId: string
    contactId: string
    preferredAgentUserId: string | null
    leadAutoAssignEnabled: boolean
    conversationId: string | null
  },
): Promise<void> {
  const { data: stages, error: stagesErr } = await db
    .from('pipeline_stages')
    .select('id, position, is_qualified_stage, is_followup_stage, is_won_stage, is_lost_stage')
    .eq('pipeline_id', deal.pipeline_id)
  if (stagesErr || !Array.isArray(stages)) {
    console.error('[ai lead-scoring] stage lookup failed:', stagesErr?.message)
    return
  }

  const qualified = stages.find((st) => st.is_qualified_stage)
  if (!qualified) {
    console.warn(
      `[ai lead-scoring] pipeline ${deal.pipeline_id} has no stage marked as qualified — leaving deal ${deal.id} in place`,
    )
    return
  }
  const current = stages.find((st) => st.id === deal.stage_id)
  const movingToQualified =
    deal.stage_id !== qualified.id &&
    (!current ||
      current.is_followup_stage === true ||
      (!current.is_won_stage && !current.is_lost_stage && current.position < qualified.position))

  const updates: Record<string, unknown> = {}
  if (movingToQualified) updates.stage_id = qualified.id
  if (!deal.assigned_to) {
    const ownerProfileId = await resolveDealOwnerProfileId(db, {
      accountId: args.accountId,
      preferredAgentUserId: args.preferredAgentUserId,
      leadAutoAssignEnabled: args.leadAutoAssignEnabled,
    })
    if (ownerProfileId) updates.assigned_to = ownerProfileId
  }
  if (Object.keys(updates).length === 0) return

  updates.updated_at = new Date().toISOString()
  const { error: moveErr } = await db.from('deals').update(updates).eq('id', deal.id)
  if (moveErr) {
    console.error('[ai lead-scoring] failed to update deal (stage/owner):', moveErr.message)
  } else if (movingToQualified) {
    // Only a real stage transition counts as "the AI qualified this lead".
    await logAiActivity(db, {
      accountId: args.accountId,
      conversationId: args.conversationId,
      contactId: args.contactId,
      eventType: 'lead_qualified',
    })
  }
}

/**
 * Resolve who a newly-qualified deal should be owned by: the thread's
 * current human handler if there is one, otherwise a fresh round-robin
 * pick when the account opted into `lead_auto_assign_enabled` — same
 * pool/cursor every other assignment path draws from (migration 042),
 * so leads land evenly across the team regardless of which mechanism
 * handed them out. Returns null (leave unowned) when neither applies.
 */
async function resolveDealOwnerProfileId(
  db: SupabaseClient,
  args: {
    accountId: string
    preferredAgentUserId: string | null
    leadAutoAssignEnabled: boolean
  },
): Promise<string | null> {
  const { accountId, preferredAgentUserId, leadAutoAssignEnabled } = args
  const ownerAuthId =
    preferredAgentUserId ?? (leadAutoAssignEnabled ? await pickRoundRobinAgent(db, accountId) : null)
  return resolveProfileId(db, ownerAuthId)
}

async function findQualifiedStageId(
  db: SupabaseClient,
  pipelineId: string,
): Promise<string | null> {
  const { data, error } = await db
    .from('pipeline_stages')
    .select('id')
    .eq('pipeline_id', pipelineId)
    .eq('is_qualified_stage', true)
    .maybeSingle()
  if (error) {
    console.error('[ai lead-scoring] qualified-stage lookup failed:', error.message)
    return null
  }
  return data?.id ?? null
}
