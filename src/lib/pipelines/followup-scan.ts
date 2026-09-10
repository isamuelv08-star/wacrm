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
// No dedupe marker needed (unlike hot-lead-alerts' timestamp trick):
// once a deal is moved into the followup stage, the `stage_id !==
// stage.id` filter below excludes it from the very next pass — moving
// IS the terminal, idempotent action.
// ============================================================

const MAX_STAGES_PER_SCAN = 200
const MAX_DEALS_PER_STAGE_SCAN = 200

export interface FollowupStageScanResult {
  scanned: number
  moved: number
}

interface FollowupStageRow {
  id: string
  pipeline_id: string
  // Embedded relations — loosely typed at the DB boundary, same
  // posture as CandidateConversation in hot-lead-alerts.ts.
  pipelines: { accounts: { followup_after_hours: number } }
}

interface CandidateDeal {
  id: string
  conversation_id: string | null
}

/**
 * Scan every account's Seguimiento stage(s) for open deals that have
 * gone quiet past that account's configured threshold, and move them
 * in.
 */
export async function runFollowupStageScan(
  db: SupabaseClient,
): Promise<FollowupStageScanResult> {
  const { data: stages, error } = await db
    .from('pipeline_stages')
    .select('id, pipeline_id, pipelines!inner(accounts!inner(followup_after_hours))')
    .eq('is_followup_stage', true)
    .limit(MAX_STAGES_PER_SCAN)

  if (error) {
    console.error('[followup-stage] stage scan failed:', error.message)
    return { scanned: 0, moved: 0 }
  }
  if (!stages || stages.length === 0) {
    return { scanned: 0, moved: 0 }
  }

  let scanned = 0
  let moved = 0
  const now = Date.now()

  for (const stage of stages as unknown as FollowupStageRow[]) {
    try {
      const thresholdHours = stage.pipelines.accounts.followup_after_hours
      if (!thresholdHours || thresholdHours <= 0) continue // disabled for this account

      // Open deals elsewhere in this pipeline — `status = 'open'`
      // already excludes anything sitting in a won/lost stage (the
      // stage-outcome sync trigger, migration 060, keeps that in
      // sync), so this alone is "still active, not already there".
      const { data: candidates, error: dealsErr } = await db
        .from('deals')
        .select('id, conversation_id')
        .eq('pipeline_id', stage.pipeline_id)
        .eq('status', 'open')
        .neq('stage_id', stage.id)
        .limit(MAX_DEALS_PER_STAGE_SCAN)
      if (dealsErr) {
        console.error('[followup-stage] deal scan failed:', dealsErr.message)
        continue
      }
      if (!candidates || candidates.length === 0) continue

      for (const deal of candidates as CandidateDeal[]) {
        scanned++
        try {
          if (!deal.conversation_id) continue

          const { data: lastMessage, error: msgErr } = await db
            .from('messages')
            .select('sender_type, created_at')
            .eq('conversation_id', deal.conversation_id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()
          if (msgErr) {
            console.error('[followup-stage] last-message lookup failed:', msgErr.message)
            continue
          }
          // No message yet, or the customer had the last word — not
          // quiet on their end, nothing to do.
          if (!lastMessage || lastMessage.sender_type === 'customer') continue

          const elapsedMs = now - new Date(lastMessage.created_at).getTime()
          if (elapsedMs < thresholdHours * 3_600_000) continue

          const { error: updateErr } = await db
            .from('deals')
            .update({ stage_id: stage.id })
            .eq('id', deal.id)
          if (updateErr) {
            console.error('[followup-stage] move failed:', updateErr.message)
            continue
          }
          moved++
        } catch (err) {
          console.error('[followup-stage] scan failed for deal', deal.id, err)
        }
      }
    } catch (err) {
      console.error('[followup-stage] scan failed for stage', stage.id, err)
    }
  }

  return { scanned, moved }
}
