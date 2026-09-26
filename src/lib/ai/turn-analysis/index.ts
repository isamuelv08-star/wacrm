import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '../admin-client'
import { loadAiConfig } from '../config'
import { buildAnalysisTranscript } from '../context'
import { runProvider } from '../generate'
import { applyLeadScore } from '../lead-scoring'
import { applyContactName, isPlaceholderName } from '../contact-actions'
import { logAiActivity } from '../activity-log'
import { isAiError, notifyProviderErrorIfNeeded } from '../provider-alert'
import { logAiUsage } from '../usage'
import { describeNowInZone } from '../timezone'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { updateDealStage } from '@/lib/deals/stage-write'
import { addContactTagIfAbsent } from '@/lib/contacts/tag-write'
import {
  buildTurnAnalysisPrompt,
  decideDealMove,
  evidenceInTranscript,
  normalizeForMatch,
  parseTurnAnalysis,
  type CustomFieldForAnalysis,
  type Facts,
  type StageForAnalysis,
  type TurnAnalysis,
} from './core'
import { classifyLeadIfNeeded } from '../lead-classify'

// ============================================================
// Per-turn analysis — the AI's CRM copilot.
//
// One structured JSON call per conversation turn that reads the WHOLE
// thread (customer, advisor and bot messages, with timestamps and media
// descriptions) and updates the CRM:
//   - lead score (the account's qualification criteria, when set),
//   - contact facts (need, budget, city, product…) merged into
//     contact_intelligence — never wiping what's already known,
//   - contact name / email / company when missing, custom fields, tags,
//   - the deal: forward through the pipeline stage by stage, and closed
//     as won/lost when the conversation proves it (a payment receipt, the
//     advisor confirming the order), with the quote that proves it,
//   - a one-line deal summary.
//
// It runs on customer messages AND advisor messages (from the CRM or
// the phone app), whether or not the AI replies — so "the AI doesn't
// answer but reads and reviews" finally holds. Before this, stage moves
// only happened through tags appended to the AI's own reply (never when
// humans answered, never on an advisor's "pedido confirmado"), the
// classifier never went past "qualified", and in production the AI had
// closed zero sales while 85% of deals sat parked in follow-up.
//
// Never throws; every write is guarded (see decideDealMove and the
// merge rules below).
// ============================================================

export interface TurnAnalysisArgs {
  accountId: string
  conversationId: string
  contactId: string
  configOwnerUserId: string
  /** What woke this analysis up. */
  trigger: 'customer' | 'advisor'
  /** The inbound message, for the legacy classifier fallback. */
  messageId?: string
}

/** Quiet period before analysing, so a burst of messages is one turn. */
const DEBOUNCE_MS = 10_000
const BUSINESS_CONTEXT_CHARS = 2_500

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function latestMessageId(db: SupabaseClient, conversationId: string): Promise<string | null> {
  const { data } = await db
    .from('messages')
    .select('id')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data?.id as string | undefined) ?? null
}

export async function analyzeTurnIfNeeded(args: TurnAnalysisArgs): Promise<void> {
  const { accountId, conversationId, contactId } = args
  try {
    const db = supabaseAdmin()
    const config = await loadAiConfig(db, accountId)
    if (!config) return
    if (!config.dealProgressEnabled) {
      // Turned off for this account: keep the old per-message scoring.
      if (args.trigger === 'customer' && args.messageId) {
        await classifyLeadIfNeeded({
          accountId,
          conversationId,
          contactId,
          configOwnerUserId: args.configOwnerUserId,
          messageId: args.messageId,
        })
      }
      return
    }

    // Debounce on ANY new message (customer, advisor or bot): whoever
    // wrote last owns the analysis of this turn.
    const startLatest = await latestMessageId(db, conversationId)
    await sleep(DEBOUNCE_MS)
    if ((await latestMessageId(db, conversationId)) !== startLatest) return

    const limit = checkRateLimit(`ai-turn:${accountId}`, RATE_LIMITS.aiClassifyAccount)
    if (!limit.success) {
      console.warn(`[turn-analysis] account ${accountId} hit the rate limit — skipping this turn`)
      return
    }

    const ctx = await loadContext(db, args)
    if (!ctx || ctx.lineCount === 0) return

    const systemPrompt = buildTurnAnalysisPrompt({
      businessContext: config.systemPrompt ? config.systemPrompt.slice(0, BUSINESS_CONTEXT_CHARS) : null,
      qualificationCriteria: config.qualificationCriteria?.trim() || null,
      stages: ctx.stages,
      currentStageId: ctx.deal?.stage_id ?? null,
      knownFacts: ctx.knownFacts,
      previousScore: ctx.contact.lead_score,
      previousScoreReason: ctx.contact.lead_score_reason,
      customFields: ctx.customFields,
      tags: ctx.tagNames,
      currency: ctx.deal?.currency ?? ctx.currency,
      nowLabel: describeNowInZone(ctx.timezone),
    })

    const assessedBefore = ctx.contact.lead_score_assessed_at
    const { text, usage } = await (async () => {
      try {
        return await runProvider({ config, systemPrompt, messages: [{ role: 'user', content: ctx.transcript }] })
      } catch (err) {
        if (isAiError(err)) await notifyProviderErrorIfNeeded(db, accountId, err)
        throw err
      }
    })()
    void logAiUsage(db, {
      accountId,
      conversationId,
      mode: 'turn_analysis',
      provider: config.provider,
      model: config.model,
      usage,
    })

    const analysis = parseTurnAnalysis(text)
    const normalized = normalizeForMatch(ctx.transcript)

    await applyFacts(db, ctx, analysis, normalized)
    await applyCustomFields(db, ctx, analysis)
    await applyTags(db, ctx, analysis)

    // Score — only against the account's own criteria, and never over a
    // newer assessment that landed while this call was running.
    if (analysis.score && config.qualificationCriteria?.trim()) {
      const { data: now } = await db
        .from('contacts')
        .select('lead_score_assessed_at')
        .eq('id', contactId)
        .maybeSingle()
      if ((now?.lead_score_assessed_at ?? null) === assessedBefore) {
        await applyLeadScore(db, {
          accountId,
          contactId,
          configOwnerUserId: args.configOwnerUserId,
          score: analysis.score,
          reason: analysis.scoreReason,
          source: 'ai',
          preferredAgentUserId: ctx.assignedAgentId,
          leadAutoAssignEnabled: config.leadAutoAssignEnabled,
          conversationId,
        })
      }
    }

    await applyDeal(db, ctx, analysis, normalized, {
      minConfidence: config.dealProgressMinConfidence,
      holdHours: config.stageHumanHoldHours,
      trigger: args.trigger,
    })
  } catch (err) {
    console.error('[turn-analysis] failed for conversation', conversationId, err)
  }
}

// ------------------------------------------------------------
// Context
// ------------------------------------------------------------

interface DealRow {
  id: string
  pipeline_id: string
  stage_id: string
  status: string
  value: number | null
  currency: string | null
  pre_followup_stage_id?: string | null
}

interface AnalysisContext {
  accountId: string
  conversationId: string
  contactId: string
  transcript: string
  lineCount: number
  timezone: string
  currency: string | null
  assignedAgentId: string | null
  contact: {
    name: string | null
    email: string | null
    company: string | null
    lead_score: string | null
    lead_score_reason: string | null
    lead_score_assessed_at: string | null
  }
  knownFacts: Facts
  deal: DealRow | null
  stages: StageForAnalysis[]
  customFields: (CustomFieldForAnalysis & { id: string; currentSource: string | null })[]
  tagNames: string[]
  tagIdByName: Map<string, string>
}

async function loadContext(db: SupabaseClient, args: TurnAnalysisArgs): Promise<AnalysisContext | null> {
  const { accountId, conversationId, contactId } = args

  const [{ data: account }, { data: contact }, { data: conv }] = await Promise.all([
    db.from('accounts').select('timezone, default_currency').eq('id', accountId).maybeSingle(),
    db
      .from('contacts')
      .select('name, email, company, lead_score, lead_score_reason, lead_score_assessed_at')
      .eq('id', contactId)
      .eq('account_id', accountId)
      .maybeSingle(),
    db.from('conversations').select('assigned_agent_id').eq('id', conversationId).maybeSingle(),
  ])
  if (!contact) return null
  const timezone = (account?.timezone as string | null) || 'UTC'

  const { transcript, lineCount } = await buildAnalysisTranscript(db, conversationId, { timezone })

  // Open deal (with the 114 column when present).
  let deal: DealRow | null = null
  {
    const sel = 'id, pipeline_id, stage_id, status, value, currency'
    const withPre = await db
      .from('deals')
      .select(`${sel}, pre_followup_stage_id`)
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .eq('status', 'open')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (!withPre.error) deal = (withPre.data as DealRow | null) ?? null
    else {
      const plain = await db
        .from('deals')
        .select(sel)
        .eq('account_id', accountId)
        .eq('contact_id', contactId)
        .eq('status', 'open')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()
      deal = (plain.data as DealRow | null) ?? null
    }
  }

  let stages: StageForAnalysis[] = []
  if (deal) {
    const full = await db
      .from('pipeline_stages')
      .select('id, name, position, ai_description, is_qualified_stage, is_won_stage, is_lost_stage, is_followup_stage')
      .eq('pipeline_id', deal.pipeline_id)
      .order('position', { ascending: true })
    const rows = !full.error
      ? full.data
      : (
          await db
            .from('pipeline_stages')
            .select('id, name, position, is_qualified_stage, is_won_stage, is_lost_stage, is_followup_stage')
            .eq('pipeline_id', deal.pipeline_id)
            .order('position', { ascending: true })
        ).data
    stages = ((rows ?? []) as Record<string, unknown>[]).map((r) => ({
      id: r.id as string,
      name: r.name as string,
      position: r.position as number,
      description: (r.ai_description as string | null | undefined) ?? null,
      isQualified: r.is_qualified_stage === true,
      isWon: r.is_won_stage === true,
      isLost: r.is_lost_stage === true,
      isFollowup: r.is_followup_stage === true,
    }))
  }

  const [{ data: intel }, { data: fieldDefs }, { data: tagRows }] = await Promise.all([
    db.from('contact_intelligence').select('*').eq('contact_id', contactId).maybeSingle(),
    db.from('custom_fields').select('id, field_name, field_type, field_options').eq('account_id', accountId),
    db.from('tags').select('id, name').eq('account_id', accountId),
  ])

  const fieldIds = ((fieldDefs ?? []) as { id: string }[]).map((f) => f.id)
  let values: { custom_field_id: string; value: string | null; source?: string | null }[] = []
  if (fieldIds.length) {
    const withSource = await db
      .from('contact_custom_values')
      .select('custom_field_id, value, source')
      .eq('contact_id', contactId)
      .in('custom_field_id', fieldIds)
    values = (
      !withSource.error
        ? withSource.data
        : (
            await db
              .from('contact_custom_values')
              .select('custom_field_id, value')
              .eq('contact_id', contactId)
              .in('custom_field_id', fieldIds)
          ).data
    ) as typeof values
  }
  const valueByField = new Map(values.map((v) => [v.custom_field_id, v]))

  const i = (intel ?? {}) as Record<string, string | null>
  const knownFacts: Facts = {
    name: isPlaceholderName(contact.name) ? undefined : (contact.name as string),
    email: contact.email ?? undefined,
    company: contact.company ?? undefined,
    city: i.city ?? undefined,
    need: i.need ?? undefined,
    budget: i.budget ?? undefined,
    objection: i.objection ?? undefined,
    productInterest: i.product_interest ?? undefined,
    timeline: i.timeline ?? undefined,
    quantity: i.quantity ?? undefined,
  }

  const tags = (tagRows ?? []) as { id: string; name: string }[]
  return {
    accountId,
    conversationId,
    contactId,
    transcript,
    lineCount,
    timezone,
    currency: (account?.default_currency as string | null) ?? null,
    assignedAgentId: (conv?.assigned_agent_id as string | null) ?? null,
    contact: contact as AnalysisContext['contact'],
    knownFacts,
    deal,
    stages,
    customFields: ((fieldDefs ?? []) as { id: string; field_name: string; field_type: string; field_options: { options?: string[] } | null }[]).map(
      (f) => ({
        id: f.id,
        name: f.field_name,
        type: f.field_type,
        options: f.field_options?.options ?? [],
        currentValue: valueByField.get(f.id)?.value ?? null,
        currentSource: valueByField.get(f.id)?.source ?? (valueByField.has(f.id) ? 'manual' : null),
      }),
    ),
    tagNames: tags.map((t) => t.name),
    tagIdByName: new Map(tags.map((t) => [t.name.trim().toLowerCase(), t.id])),
  }
}

// ------------------------------------------------------------
// Appliers
// ------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/**
 * Contact facts: MERGED into contact_intelligence (a fact the model
 * didn't repeat this turn is kept, not nulled — the old classifier
 * rewrote the whole row every message and lost what scrolled out of its
 * window). Name / email / company go on the contact only when missing,
 * and email only if it literally appears in the conversation.
 */
async function applyFacts(db: SupabaseClient, ctx: AnalysisContext, a: TurnAnalysis, normalized: string) {
  const f = a.facts
  if (f.name && isPlaceholderName(ctx.contact.name)) {
    await applyContactName(db, { contactId: ctx.contactId, name: f.name })
  }
  const contactPatch: Record<string, string> = {}
  if (f.email && !ctx.contact.email && EMAIL_RE.test(f.email) && normalized.includes(normalizeForMatch(f.email))) {
    contactPatch.email = f.email.toLowerCase()
  }
  if (f.company && !ctx.contact.company) contactPatch.company = f.company
  if (Object.keys(contactPatch).length) {
    await db
      .from('contacts')
      .update({ ...contactPatch, updated_at: new Date().toISOString() })
      .eq('id', ctx.contactId)
      .eq('account_id', ctx.accountId)
  }

  const intel: Record<string, unknown> = {}
  const map: [keyof Facts, string][] = [
    ['need', 'need'],
    ['budget', 'budget'],
    ['objection', 'objection'],
    ['productInterest', 'product_interest'],
    ['city', 'city'],
    ['timeline', 'timeline'],
    ['quantity', 'quantity'],
  ]
  for (const [k, col] of map) if (f[k]) intel[col] = f[k]
  if (!Object.keys(intel).length) return

  const row: Record<string, unknown> = {
    contact_id: ctx.contactId,
    account_id: ctx.accountId,
    ...intel,
    evidence: Object.keys(a.factEvidence).length ? a.factEvidence : undefined,
    source_conversation_id: ctx.conversationId,
    updated_at: new Date().toISOString(),
  }
  if (row.evidence === undefined) delete row.evidence
  // Upsert only the columns we have values for — existing ones survive.
  let { error } = await db.from('contact_intelligence').upsert(row, { onConflict: 'contact_id' })
  if (error && /city|timeline|quantity|evidence/.test(error.message)) {
    // Pre-114: only the original columns exist.
    const legacy: Record<string, unknown> = { contact_id: ctx.contactId, account_id: ctx.accountId, updated_at: row.updated_at }
    for (const col of ['need', 'budget', 'objection', 'product_interest']) if (row[col]) legacy[col] = row[col]
    if (Object.keys(legacy).length > 3) ({ error } = await db.from('contact_intelligence').upsert(legacy, { onConflict: 'contact_id' }))
  }
  if (error) console.error('[turn-analysis] saving facts failed:', error.message)
}

/**
 * Custom fields: only the account's own fields, only when empty or last
 * set by the AI (a value a person typed is never overwritten), select
 * fields only with one of their options.
 */
async function applyCustomFields(db: SupabaseClient, ctx: AnalysisContext, a: TurnAnalysis) {
  for (const [name, value] of Object.entries(a.customFields)) {
    const field = ctx.customFields.find((f) => f.name.trim().toLowerCase() === name.trim().toLowerCase())
    if (!field) continue
    if (field.currentValue && field.currentSource !== 'ai') continue
    if (field.currentValue === value) continue
    let finalValue = value
    if (field.options.length) {
      const match = field.options.find((o) => o.trim().toLowerCase() === value.trim().toLowerCase())
      if (!match) continue
      finalValue = match
    }
    const row = { contact_id: ctx.contactId, custom_field_id: field.id, value: finalValue, source: 'ai' }
    let { error } = await db.from('contact_custom_values').upsert(row, { onConflict: 'contact_id,custom_field_id' })
    if (error && /source/.test(error.message)) {
      // Pre-114: no origin column — then only ever fill an EMPTY field.
      if (field.currentValue) continue
      ;({ error } = await db
        .from('contact_custom_values')
        .upsert({ contact_id: ctx.contactId, custom_field_id: field.id, value: finalValue }, { onConflict: 'contact_id,custom_field_id' }))
    }
    if (error) console.error('[turn-analysis] saving custom field failed:', error.message)
  }
}

/** Tags: only existing ones, only added (never removed). */
async function applyTags(db: SupabaseClient, ctx: AnalysisContext, a: TurnAnalysis) {
  for (const name of a.tags) {
    const tagId = ctx.tagIdByName.get(name.trim().toLowerCase())
    if (!tagId) continue
    try {
      await addContactTagIfAbsent(db, { accountId: ctx.accountId, contactId: ctx.contactId, tagId })
    } catch (err) {
      console.error('[turn-analysis] adding tag failed:', err)
    }
  }
}

/**
 * The deal: summary, value, and a stage move / close decided by
 * decideDealMove. Every assessment is logged to deal_ai_assessments
 * (migration 114), applied or not, and applied moves show in the thread
 * as an activity pill.
 */
async function applyDeal(
  db: SupabaseClient,
  ctx: AnalysisContext,
  a: TurnAnalysis,
  normalized: string,
  opts: { minConfidence: number; holdHours: number; trigger: 'customer' | 'advisor' },
) {
  const deal = ctx.deal
  if (!deal || !ctx.stages.length) return

  // A human moved it recently → their decision stands.
  let humanHold = false
  if (opts.holdHours > 0) {
    const since = new Date(Date.now() - opts.holdHours * 3_600_000).toISOString()
    const { data: humanMove, error } = await db
      .from('deal_stage_history')
      .select('id')
      .eq('deal_id', deal.id)
      .eq('source', 'human')
      .gte('changed_at', since)
      .limit(1)
      .maybeSingle()
    humanHold = !error && !!humanMove
  }

  const decision = decideDealMove({
    stages: ctx.stages,
    currentStageId: deal.stage_id,
    preFollowupStageId: deal.pre_followup_stage_id ?? null,
    analysis: a,
    stageEvidenceOk: evidenceInTranscript(a.stageEvidence, normalized),
    outcomeEvidenceOk: evidenceInTranscript(a.outcomeEvidence, normalized),
    minConfidence: opts.minConfidence,
    humanHold,
  })

  const patch: Record<string, unknown> = {}
  if (a.summary) patch.ai_summary = a.summary
  if (a.dealValue && (!deal.value || deal.value === 0) && evidenceInTranscript(a.valueEvidence, normalized)) {
    patch.value = a.dealValue
  }

  let applied = false
  if (decision.action !== 'none') {
    const stagePatch: Record<string, unknown> = { ...patch, stage_id: decision.toStageId, pre_followup_stage_id: null }
    // The migration 060 trigger syncs stage → status, but be explicit.
    if (decision.action === 'won' || decision.action === 'lost') stagePatch.status = decision.action
    const { updated, error } = await updateDealStage(db, deal.id, stagePatch, 'ai', {
      stage_id: deal.stage_id,
      status: 'open',
    })
    if (error) console.error('[turn-analysis] deal update failed:', error)
    applied = updated
  } else if (Object.keys(patch).length) {
    await db.from('deals').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', deal.id).eq('status', 'open')
  }

  const target = decision.action !== 'none' ? ctx.stages.find((s) => s.id === decision.toStageId) : null
  if (applied && target) {
    await logAiActivity(db, {
      accountId: ctx.accountId,
      conversationId: ctx.conversationId,
      contactId: ctx.contactId,
      eventType: decision.action === 'won' ? 'ai_deal_won' : decision.action === 'lost' ? 'ai_deal_lost' : 'ai_stage_changed',
      payload: {
        stageName: target.name,
        evidence: (decision.action === 'move' ? a.stageEvidence : a.outcomeEvidence) ?? undefined,
        reason: a.reason ?? undefined,
      },
    })
  }

  // Audit trail (pre-114 the table doesn't exist — ignore).
  if (a.stageKey || a.outcome) {
    await db.from('deal_ai_assessments').insert({
      account_id: ctx.accountId,
      deal_id: deal.id,
      conversation_id: ctx.conversationId,
      trigger: opts.trigger,
      from_stage_id: deal.stage_id,
      recommended_stage_id: decision.action !== 'none' ? decision.toStageId : null,
      outcome: a.outcome,
      confidence: a.outcome ? a.outcomeConfidence : a.stageConfidence,
      evidence: { stage: a.stageEvidence, outcome: a.outcomeEvidence, value: a.valueEvidence },
      reason: a.reason,
      applied,
      skip_reason: decision.action === 'none' ? decision.skipReason : applied ? null : 'write_conflict',
    })
  }
}

/**
 * An advisor wrote (from the CRM or the phone app): analyse the turn
 * too — the sale is often confirmed in the advisor's own message
 * ("listo, pedido confirmado", "recibimos tu pago"), and before this
 * nothing read it until the customer happened to write again.
 */
export async function analyzeAfterAdvisorMessage(args: {
  accountId: string
  conversationId: string
  actorUserId: string | null
}): Promise<void> {
  try {
    const db = supabaseAdmin()
    const { data: conv } = await db
      .from('conversations')
      .select('contact_id, user_id')
      .eq('id', args.conversationId)
      .eq('account_id', args.accountId)
      .maybeSingle()
    if (!conv?.contact_id) return
    await analyzeTurnIfNeeded({
      accountId: args.accountId,
      conversationId: args.conversationId,
      contactId: conv.contact_id as string,
      configOwnerUserId: args.actorUserId ?? (conv.user_id as string),
      trigger: 'advisor',
    })
  } catch (err) {
    console.error('[turn-analysis] advisor-triggered analysis failed:', err)
  }
}
