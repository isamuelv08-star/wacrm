import type { SupabaseClient } from '@supabase/supabase-js'
import type { LeadScore } from './types'

// ============================================================
// Apply a lead score the AI auto-reply bot emitted via the
// `[[SCORE:...]]` sentinel (see defaults.ts / generate.ts).
//
// Two independent effects, both best-effort — a failure here must
// never take down the customer-facing reply that already sent:
//   1. Always persist the score onto `contacts.lead_score`.
//   2. Only for HOT: advance the contact's deal to whichever stage
//      the account has designated "the qualified stage" for that
//      deal's pipeline (pipeline_stages.is_qualified_stage, migration
//      038). If the contact has no open deal, one is created directly
//      in the qualified stage — mirrors webhook-processor.ts's
//      ensureLeadDeal, except targeting the qualified stage instead
//      of the first one, since a HOT lead should never sit unqualified
//      just because it's the first time we're tracking it.
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
  },
): Promise<void> {
  const { accountId, contactId, configOwnerUserId, score } = args

  try {
    const { error: scoreErr } = await db
      .from('contacts')
      .update({ lead_score: score, updated_at: new Date().toISOString() })
      .eq('id', contactId)
      .eq('account_id', accountId)
    if (scoreErr) {
      console.error('[ai lead-scoring] failed to persist lead_score:', scoreErr.message)
    }

    if (score !== 'hot') return // only HOT advances the deal — see applyLeadScore's doc comment

    const { data: openDeal, error: dealErr } = await db
      .from('deals')
      .select('id, pipeline_id, stage_id')
      .eq('contact_id', contactId)
      .eq('account_id', accountId)
      .eq('status', 'open')
      .limit(1)
      .maybeSingle()
    if (dealErr) {
      console.error('[ai lead-scoring] open-deal lookup failed:', dealErr.message)
      return
    }

    if (openDeal) {
      const qualifiedStageId = await findQualifiedStageId(db, openDeal.pipeline_id)
      if (!qualifiedStageId) {
        console.warn(
          `[ai lead-scoring] pipeline ${openDeal.pipeline_id} has no stage marked as qualified — leaving deal ${openDeal.id} in place`,
        )
        return
      }
      if (openDeal.stage_id === qualifiedStageId) return // already there

      const { error: moveErr } = await db
        .from('deals')
        .update({ stage_id: qualifiedStageId, updated_at: new Date().toISOString() })
        .eq('id', openDeal.id)
      if (moveErr) {
        console.error('[ai lead-scoring] failed to move deal to qualified stage:', moveErr.message)
      }
      return
    }

    // No open deal — same "first pipeline by created_at" convention as
    // ensureLeadDeal, but land straight in the qualified stage rather
    // than the first one.
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

    const { data: acct } = await db
      .from('accounts')
      .select('default_currency')
      .eq('id', accountId)
      .maybeSingle()

    const { error: insertErr } = await db.from('deals').insert({
      account_id: accountId,
      user_id: configOwnerUserId,
      pipeline_id: pipeline.id,
      stage_id: qualifiedStageId,
      contact_id: contactId,
      title: contact.name || contact.phone,
      value: 0,
      currency: acct?.default_currency ?? 'USD',
      status: 'open',
    })
    if (insertErr) {
      console.error('[ai lead-scoring] failed to create deal in qualified stage:', insertErr.message)
    }
  } catch (err) {
    console.error('[ai lead-scoring] applyLeadScore failed:', err)
  }
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
