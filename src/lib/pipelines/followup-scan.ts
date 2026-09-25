import type { SupabaseClient } from '@supabase/supabase-js'

// ============================================================
// Automatic "move to Seguimiento" — the follow-up-stage counterpart to
// ensureDealInQualifiedStage() (src/lib/ai/lead-scoring.ts): once an
// account has a stage flagged is_followup_stage (migration 077), any
// open deal in that pipeline whose conversation has gone unanswered by
// the customer past the account's followup_after_hours threshold
// (migration 078) gets moved there automatically — same "the system
// just does it" dynamic that already moves HOT leads into Qualified,
// just triggered by elapsed time instead of a score change, so it has
// to run on a schedule rather than reactively.
//
// Invoked on a schedule via GET /api/cron/followup-stage (same shared-
// secret pattern as /api/cron/hot-lead-alerts). Best-effort per deal —
// one failure must never stop the rest of the scan.
//
// No dedupe marker needed: once a deal is moved into the followup
// stage, the `stage_id != stage.id` filter excludes it from the next
// pass — moving IS the terminal, idempotent action.
//
// Scale: stages and candidate deals are paged deterministically (the
// old fixed LIMIT 200 with no ORDER BY returned the same rows every
// run, so beyond 200 the rest were never looked at), and "gone quiet"
// is filtered in SQL off conversations.last_message_* (migration 050)
// instead of one messages query per deal.
// ============================================================

const PAGE_SIZE = 500
const HISTORY_CHUNK = 100

export interface FollowupStageScanResult {
  scanned: number
  moved: number
}

interface FollowupStageRow {
  id: string
  pipeline_id: string
  // Embedded relations — loosely typed at the DB boundary.
  pipelines: { accounts: { followup_after_hours: number } }
}

interface CandidateDeal {
  id: string
  conversation: { last_message_at: string | null } | null
}

/**
 * Scan every account's Seguimiento stage(s) for open deals that have
 * gone quiet past that account's configured threshold, and move them
 * in.
 */
export async function runFollowupStageScan(
  db: SupabaseClient,
): Promise<FollowupStageScanResult> {
  let scanned = 0
  let moved = 0
  const now = Date.now()

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data: stages, error } = await db
      .from('pipeline_stages')
      .select('id, pipeline_id, pipelines!inner(accounts!inner(followup_after_hours))')
      .eq('is_followup_stage', true)
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
    if (error) {
      console.error('[followup-stage] stage scan failed:', error.message)
      break
    }
    if (!stages || stages.length === 0) break

    for (const stage of stages as unknown as FollowupStageRow[]) {
      try {
        const result = await scanStage(db, stage, now)
        scanned += result.scanned
        moved += result.moved
      } catch (err) {
        console.error('[followup-stage] scan failed for stage', stage.id, err)
      }
    }

    if (stages.length < PAGE_SIZE) break
  }

  return { scanned, moved }
}

async function scanStage(
  db: SupabaseClient,
  stage: FollowupStageRow,
  now: number,
): Promise<FollowupStageScanResult> {
  const thresholdHours = stage.pipelines.accounts.followup_after_hours
  if (!thresholdHours || thresholdHours <= 0) return { scanned: 0, moved: 0 } // disabled

  const cutoff = new Date(now - thresholdHours * 3_600_000).toISOString()
  let scanned = 0
  let moved = 0

  // Moving deals out of the candidate set while paging would shift
  // offsets, so collect first, then move.
  const quiet: CandidateDeal[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    // Open deals elsewhere in this pipeline whose thread's last message
    // was ours (agent/bot) and older than the threshold. `status =
    // 'open'` already excludes won/lost stages (migration 060).
    const { data: page, error } = await db
      .from('deals')
      .select('id, conversation:conversations!inner(last_message_at)')
      .eq('pipeline_id', stage.pipeline_id)
      .eq('status', 'open')
      .neq('stage_id', stage.id)
      .neq('conversation.last_message_sender_type', 'customer')
      .not('conversation.last_message_sender_type', 'is', null)
      .lte('conversation.last_message_at', cutoff)
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
    if (error) {
      console.error('[followup-stage] deal scan failed:', error.message)
      break
    }
    if (!page || page.length === 0) break
    quiet.push(...(page as unknown as CandidateDeal[]))
    if (page.length < PAGE_SIZE) break
  }
  scanned += quiet.length
  if (quiet.length === 0) return { scanned, moved }

  // Respect deliberate moves: if the deal's stage changed AFTER the
  // thread went quiet (a rep dragged it to "Propuesta" without sending
  // anything, or the AI advanced it), that placement wins — this used
  // to yank such deals back to Seguimiento on the next run.
  const lastStageChange = await latestStageChanges(db, quiet.map((d) => d.id))

  for (const deal of quiet) {
    try {
      const quietSince = deal.conversation?.last_message_at
      const changedAt = lastStageChange.get(deal.id)
      if (quietSince && changedAt && Date.parse(changedAt) > Date.parse(quietSince)) continue

      const { error: updateErr } = await db
        .from('deals')
        .update({ stage_id: stage.id })
        .eq('id', deal.id)
        .eq('status', 'open')
      if (updateErr) {
        console.error('[followup-stage] move failed:', updateErr.message)
        continue
      }
      moved++
    } catch (err) {
      console.error('[followup-stage] scan failed for deal', deal.id, err)
    }
  }

  return { scanned, moved }
}

/** deal id → most recent deal_stage_history.changed_at (migration 039). */
async function latestStageChanges(
  db: SupabaseClient,
  dealIds: string[],
): Promise<Map<string, string>> {
  const latest = new Map<string, string>()
  for (let i = 0; i < dealIds.length; i += HISTORY_CHUNK) {
    const chunk = dealIds.slice(i, i + HISTORY_CHUNK)
    const { data, error } = await db
      .from('deal_stage_history')
      .select('deal_id, changed_at')
      .in('deal_id', chunk)
    if (error) {
      console.error('[followup-stage] stage-history lookup failed:', error.message)
      continue
    }
    for (const row of (data ?? []) as { deal_id: string; changed_at: string }[]) {
      const prev = latest.get(row.deal_id)
      if (!prev || Date.parse(row.changed_at) > Date.parse(prev)) latest.set(row.deal_id, row.changed_at)
    }
  }
  return latest
}
