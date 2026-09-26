import type { SupabaseClient } from '@supabase/supabase-js'

// ============================================================
// Apply the sales-mode sentinels the AI auto-reply bot emitted this
// turn ([[STAGE:...]], [[DEAL_WON]], [[DEAL_LOST]], [[SUMMARY:...]] —
// see defaults.ts / generate.ts). Same posture as lead-scoring.ts:
// best-effort, never throws — a failure here must never take down the
// customer-facing reply that already sent.
//
// Stage matching is by exact name (case-insensitive) against the
// deal's OWN pipeline's stages — pipelines are fully user-renamed/
// reordered per account (same reason lead-scoring.ts's qualified-stage
// lookup uses an explicit flag instead of guessing), so the model is
// given the literal stage list for this deal each turn and is
// expected to copy a name back verbatim.
// ============================================================
export async function applySalesActions(
  db: SupabaseClient,
  args: {
    accountId: string
    contactId: string
    /** Raw name from [[STAGE:...]], or null if the model didn't emit one. */
    stageMove: string | null
    dealWon: boolean
    dealLost: boolean
    /** Raw text from [[SUMMARY:...]], or null if the model didn't emit one. */
    summary: string | null
    /** Parsed number from [[DEAL_VALUE:...]] (sales mode only), or null
     *  if the model didn't emit one. */
    dealValue: number | null
  },
): Promise<void> {
  const { accountId, contactId, stageMove, dealWon, dealLost, summary, dealValue } = args
  if (!stageMove && !dealWon && !dealLost && !summary && dealValue == null) return

  try {
    const { data: openDeal, error: dealErr } = await db
      .from('deals')
      .select('id, pipeline_id, stage_id, status')
      .eq('contact_id', contactId)
      .eq('account_id', accountId)
      .eq('status', 'open')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (dealErr) {
      console.error('[ai sales-actions] open-deal lookup failed:', dealErr.message)
      return
    }
    // Nothing to act on without an open deal — sales mode only drives
    // a deal that already exists (created by the normal lead-intake /
    // qualification flow), it never creates one itself.
    if (!openDeal) return

    const update: Record<string, unknown> = {}

    if (stageMove) {
      const { data: stages, error: stageErr } = await db
        .from('pipeline_stages')
        .select('id, name, position, is_won_stage, is_lost_stage, is_followup_stage')
        .eq('pipeline_id', openDeal.pipeline_id)
      if (stageErr || !Array.isArray(stages)) {
        console.error('[ai sales-actions] stage lookup failed:', stageErr?.message)
      } else {
        const target = pickStageMove(stages, openDeal.stage_id, stageMove)
        if (target.ok) {
          if (target.stageId !== openDeal.stage_id) update.stage_id = target.stageId
        } else {
          console.warn(
            `[ai sales-actions] ignoring stage move to "${stageMove}" on pipeline ${openDeal.pipeline_id}: ${target.reason}`,
          )
        }
      }
    }

    // Won takes priority if the model (incorrectly, per its own
    // instructions) emitted both in the same turn — closing a deal
    // is the more consequential of the two to get right.
    if (dealWon || dealLost) {
      // Move the card to the pipeline's won/lost stage — setting only
      // `status` left it sitting in its old column on the board (the
      // migration 060 trigger syncs stage → status, never the reverse).
      const { data: outcomeStage } = await db
        .from('pipeline_stages')
        .select('id')
        .eq('pipeline_id', openDeal.pipeline_id)
        .eq(dealWon ? 'is_won_stage' : 'is_lost_stage', true)
        .order('position', { ascending: true })
        .limit(1)
        .maybeSingle()
      if (outcomeStage) update.stage_id = outcomeStage.id
      update.status = dealWon ? 'won' : 'lost'
    }

    if (summary) {
      update.ai_summary = summary
    }

    // Sanity bound, not a business limit: a model that mis-parsed a
    // phone number or order id as a price would otherwise silently
    // overwrite the deal's real value with nonsense. Anything within
    // this range is trusted as-is — deliberately not clamped, just
    // rejected outright when clearly wrong, so a genuine (if unusual)
    // high-ticket sale still goes through.
    if (dealValue != null) {
      if (dealValue > 0 && dealValue < 1_000_000_000) {
        update.value = dealValue
      } else {
        console.warn(
          `[ai sales-actions] model emitted an out-of-range deal value ${dealValue} — ignoring.`,
        )
      }
    }

    if (Object.keys(update).length === 0) return

    update.updated_at = new Date().toISOString()
    const { error: updateErr } = await db
      .from('deals')
      .update(update)
      .eq('id', openDeal.id)
    if (updateErr) {
      console.error('[ai sales-actions] failed to update deal:', updateErr.message)
    }
  } catch (err) {
    console.error('[ai sales-actions] applySalesActions failed:', err)
  }
}

interface StageRow {
  id: string
  name: string
  position: number
  is_won_stage?: boolean | null
  is_lost_stage?: boolean | null
  is_followup_stage?: boolean | null
}

/**
 * Validate a [[STAGE:...]] request against the pipeline:
 *  - exact (case/whitespace-insensitive) name match — `.ilike()` used
 *    to treat `_`/`%` in stage names as wildcards, and a multi-match
 *    made maybeSingle() error so the move was silently dropped;
 *  - never a won/lost stage: closing goes through [[DEAL_WON]] /
 *    [[DEAL_LOST]] and their prompt rules, not a stage name;
 *  - never backwards (except out of the follow-up stage, which sits
 *    last by position but means "went quiet").
 */
export function pickStageMove(
  stages: StageRow[],
  currentStageId: string,
  requested: string,
): { ok: true; stageId: string } | { ok: false; reason: string } {
  const norm = (v: string) => v.trim().replace(/\s+/g, ' ').toLowerCase()
  const matches = stages.filter((st) => norm(st.name) === norm(requested))
  if (matches.length === 0) return { ok: false, reason: 'no stage with that name' }
  if (matches.length > 1) return { ok: false, reason: 'ambiguous stage name' }
  const target = matches[0]
  if (target.is_won_stage || target.is_lost_stage) {
    return { ok: false, reason: 'outcome stages are set via DEAL_WON / DEAL_LOST' }
  }
  const current = stages.find((st) => st.id === currentStageId)
  if (current && !current.is_followup_stage && target.position < current.position) {
    return { ok: false, reason: 'would move the deal backwards' }
  }
  return { ok: true, stageId: target.id }
}

/** Ordered stage list (+ which one is current) for the contact's open
 *  deal, fed into the sales-mode system prompt. Null when there's no
 *  open deal — sales mode has nothing to drive in that case. */
export async function loadDealStageContext(
  db: SupabaseClient,
  args: { accountId: string; contactId: string },
): Promise<{
  hasOpenDeal: boolean
  stages: { name: string; current: boolean }[]
  /** The open deal's own currency (ISO-4217), or null when there's no
   *  open deal — fed into `buildSystemPrompt`'s `salesMode.currency` so
   *  the [[DEAL_VALUE:...]] instruction names the right unit. */
  currency: string | null
}> {
  const { accountId, contactId } = args
  try {
    const { data: openDeal, error: dealErr } = await db
      .from('deals')
      .select('pipeline_id, stage_id, currency')
      .eq('contact_id', contactId)
      .eq('account_id', accountId)
      .eq('status', 'open')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (dealErr || !openDeal) return { hasOpenDeal: false, stages: [], currency: null }

    const { data: stages, error: stagesErr } = await db
      .from('pipeline_stages')
      .select('id, name')
      .eq('pipeline_id', openDeal.pipeline_id)
      .order('position', { ascending: true })
    if (stagesErr || !stages) {
      return { hasOpenDeal: true, stages: [], currency: openDeal.currency ?? null }
    }

    return {
      hasOpenDeal: true,
      stages: stages.map((s) => ({
        name: s.name as string,
        current: s.id === openDeal.stage_id,
      })),
      currency: openDeal.currency ?? null,
    }
  } catch (err) {
    console.error('[ai sales-actions] loadDealStageContext failed:', err)
    return { hasOpenDeal: false, stages: [], currency: null }
  }
}
