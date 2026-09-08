-- ============================================================
-- 070_widen_stage_outcome_backfill.sql — auto-flag won/lost stages
-- named in Spanish/Portuguese too, and drop the manual "Mark as
-- Won/Lost" buttons from the deal sheet in favor of dragging a card
-- into a stage flagged is_won_stage/is_lost_stage (migration 060).
--
-- Reported bug: dragging a deal into a "Ganado"/"Perdido" column never
-- synced `deals.status`, so pipeline metrics and the CEO dashboard
-- funnel stayed at 0 for won/lost even with cards visibly sitting
-- there. Root cause: migration 060's auto-backfill only matched the
-- literal English name "Won" (case-insensitive exact match), and only
-- ran once, historically — any account whose pipeline uses a Spanish/
-- Portuguese name (or was created after that migration ran, so it
-- never got the one-time backfill at all) has stages sitting
-- unflagged in `pipeline_stages`, so the migration-060 trigger has
-- nothing to sync from. This is this CRM's actual UI language, so a
-- name-based heuristic needs to catch it — same word list already used
-- for the stage icon heuristic in pipeline-board.tsx's stageIconKey.
--
-- Purely additive: only touches a stage whose pipeline doesn't already
-- have a won (respectively lost) stage set, so it never overrides an
-- admin's explicit choice in Settings. Idempotent — safe to re-run.
-- ============================================================

UPDATE pipeline_stages ps
SET is_won_stage = true
WHERE ps.name ~* '(won|ganad|ganho|cerrad|fechad)'
  AND NOT ps.is_lost_stage
  AND NOT EXISTS (
    SELECT 1 FROM pipeline_stages other
    WHERE other.pipeline_id = ps.pipeline_id AND other.is_won_stage
  );

UPDATE pipeline_stages ps
SET is_lost_stage = true
WHERE ps.name ~* '(lost|perdid)'
  AND NOT ps.is_won_stage
  AND NOT EXISTS (
    SELECT 1 FROM pipeline_stages other
    WHERE other.pipeline_id = ps.pipeline_id AND other.is_lost_stage
  );

-- Retroactively fix deals already sitting in a stage the backfill
-- above just flagged — same one-off correction migration 060 already
-- does for its own (narrower) backfill. closed_at is stamped by the
-- existing set_deal_closed_at trigger (migration 053), which fires on
-- this same UPDATE since it targets the `status` column.
UPDATE deals d
SET status = 'won'
FROM pipeline_stages ps
WHERE d.stage_id = ps.id
  AND ps.is_won_stage
  AND d.status IS DISTINCT FROM 'won';

UPDATE deals d
SET status = 'lost'
FROM pipeline_stages ps
WHERE d.stage_id = ps.id
  AND ps.is_lost_stage
  AND d.status IS DISTINCT FROM 'lost';
