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
  },
): Promise<void> {
  const { accountId, contactId, stageMove, dealWon, dealLost, summary } = args
  if (!stageMove && !dealWon && !dealLost && !summary) return

  try {
    const { data: openDeal, error: dealErr } = await db
      .from('deals')
      .select('id, pipeline_id, stage_id, status')
      .eq('contact_id', contactId)
      .eq('account_id', accountId)
      .eq('status', 'open')
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
      const { data: stage, error: stageErr } = await db
        .from('pipeline_stages')
        .select('id, name')
        .eq('pipeline_id', openDeal.pipeline_id)
        .ilike('name', stageMove)
        .maybeSingle()
      if (stageErr) {
        console.error('[ai sales-actions] stage lookup failed:', stageErr.message)
      } else if (!stage) {
        console.warn(
          `[ai sales-actions] model asked for stage "${stageMove}" — no exact match on pipeline ${openDeal.pipeline_id}, ignoring`,
        )
      } else if (stage.id !== openDeal.stage_id) {
        update.stage_id = stage.id
      }
    }

    // Won takes priority if the model (incorrectly, per its own
    // instructions) emitted both in the same turn — closing a deal
    // is the more consequential of the two to get right.
    if (dealWon) {
      update.status = 'won'
    } else if (dealLost) {
      update.status = 'lost'
    }

    if (summary) {
      update.ai_summary = summary
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

/** Ordered stage list (+ which one is current) for the contact's open
 *  deal, fed into the sales-mode system prompt. Null when there's no
 *  open deal — sales mode has nothing to drive in that case. */
export async function loadDealStageContext(
  db: SupabaseClient,
  args: { accountId: string; contactId: string },
): Promise<{
  hasOpenDeal: boolean
  stages: { name: string; current: boolean }[]
}> {
  const { accountId, contactId } = args
  try {
    const { data: openDeal, error: dealErr } = await db
      .from('deals')
      .select('pipeline_id, stage_id')
      .eq('contact_id', contactId)
      .eq('account_id', accountId)
      .eq('status', 'open')
      .limit(1)
      .maybeSingle()
    if (dealErr || !openDeal) return { hasOpenDeal: false, stages: [] }

    const { data: stages, error: stagesErr } = await db
      .from('pipeline_stages')
      .select('id, name')
      .eq('pipeline_id', openDeal.pipeline_id)
      .order('position', { ascending: true })
    if (stagesErr || !stages) return { hasOpenDeal: true, stages: [] }

    return {
      hasOpenDeal: true,
      stages: stages.map((s) => ({
        name: s.name as string,
        current: s.id === openDeal.stage_id,
      })),
    }
  } catch (err) {
    console.error('[ai sales-actions] loadDealStageContext failed:', err)
    return { hasOpenDeal: false, stages: [] }
  }
}
