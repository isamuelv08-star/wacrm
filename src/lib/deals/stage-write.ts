import type { SupabaseClient } from '@supabase/supabase-js'

export type StageChangeSource = 'ai' | 'system'

/**
 * Tag for deals.stage_change_source (migration 114): '<source>:<ts>',
 * unique per write so the database can tell this move's tag from a
 * stale one and record who moved the deal in deal_stage_history.
 */
export function stageSourceTag(source: StageChangeSource): string {
  return `${source}:${new Date().toISOString()}`
}

function isMissingColumn(error: { message?: string } | null, column: string): boolean {
  return Boolean(error?.message && error.message.includes(column))
}

/**
 * Update a deal (stage and anything else in `patch`) recording who moved
 * it. Retries without the 114-only columns when they don't exist yet, so
 * this is safe to ship ahead of the migration. Extra `match` filters make
 * the write conditional (compare-and-set). Returns whether a row changed.
 */
export async function updateDealStage(
  db: SupabaseClient,
  dealId: string,
  patch: Record<string, unknown>,
  source: StageChangeSource,
  match: Record<string, string> = {},
): Promise<{ updated: boolean; error: string | null }> {
  const run = async (body: Record<string, unknown>) => {
    let q = db.from('deals').update(body).eq('id', dealId)
    for (const [k, v] of Object.entries(match)) q = q.eq(k, v)
    return q.select('id')
  }
  const tagged: Record<string, unknown> = {
    ...patch,
    stage_change_source: stageSourceTag(source),
    updated_at: new Date().toISOString(),
  }
  let { data, error } = await run(tagged)
  if (error && (isMissingColumn(error, 'stage_change_source') || isMissingColumn(error, 'pre_followup_stage_id'))) {
    const legacy = { ...tagged }
    delete legacy.stage_change_source
    delete legacy.pre_followup_stage_id
    ;({ data, error } = await run(legacy))
  }
  if (error) return { updated: false, error: error.message }
  return { updated: Array.isArray(data) && data.length > 0, error: null }
}

/**
 * The customer wrote again: a deal the follow-up cron parked in
 * "Seguimiento" goes back to the stage it had reached (migration 114's
 * pre_followup_stage_id). The cron used to erase that progress — 85% of
 * open deals ended up in Seguimiento and never came back.
 */
export async function restoreDealFromFollowup(
  db: SupabaseClient,
  args: { accountId: string; contactId: string },
): Promise<void> {
  const { data: deal, error } = await db
    .from('deals')
    .select('id, stage_id, pre_followup_stage_id, stage:pipeline_stages(is_followup_stage)')
    .eq('account_id', args.accountId)
    .eq('contact_id', args.contactId)
    .eq('status', 'open')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (error || !deal) return // includes "column doesn't exist yet" — nothing to restore
  const stage = (Array.isArray(deal.stage) ? deal.stage[0] : deal.stage) as { is_followup_stage?: boolean } | null
  if (!stage?.is_followup_stage || !deal.pre_followup_stage_id) return

  const { error: updateErr } = await updateDealStage(
    db,
    deal.id as string,
    { stage_id: deal.pre_followup_stage_id, pre_followup_stage_id: null },
    'system',
    { stage_id: deal.stage_id as string },
  )
  if (updateErr) console.error('[deals] restoring a deal from follow-up failed:', updateErr)
}
