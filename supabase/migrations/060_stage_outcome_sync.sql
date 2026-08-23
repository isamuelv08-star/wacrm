-- ============================================================
-- 060_stage_outcome_sync.sql — let a pipeline stage mean "won" or
-- "lost", and auto-sync deals.status when a deal is dragged into one.
--
-- Today `deals.status` (open/won/lost) and `deals.stage_id` (which
-- column the card sits in) are entirely independent — moving a card
-- to a custom stage (say, one named "Perdidos") never touches
-- `status`. Reported bug: a "Lost" pipeline-analytics count stuck at
-- 0 even with deals visibly sitting in a "Perdidos" stage, because
-- none of them actually have status = 'lost'. Same shape as
-- `is_qualified_stage` (migration 038): an explicit admin-set flag on
-- the stage, not a guess from its name or position, since stages are
-- freely renamable/reorderable/addable.
--
-- Two sync points, both stage -> status (never the reverse): (1)
-- a deal created or dragged into a won/lost stage gets its status
-- (and closed_at — the existing set_deal_closed_at trigger, migration
-- 053, only fires on an UPDATE that targets the `status` column,
-- which a stage-only move never does) synced immediately; (2) an
-- admin marking a stage won/lost in Settings retroactively fixes
-- every deal already sitting there. The explicit "Mark as Won/Lost"
-- buttons in the deal sheet still work exactly as before and are NOT
-- changed here to also move the stage — that's a separate decision
-- nobody has asked for yet.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE pipeline_stages
  ADD COLUMN IF NOT EXISTS is_won_stage BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE pipeline_stages
  ADD COLUMN IF NOT EXISTS is_lost_stage BOOLEAN NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pipeline_stages_not_both_won_and_lost'
  ) THEN
    ALTER TABLE pipeline_stages
      ADD CONSTRAINT pipeline_stages_not_both_won_and_lost
      CHECK (NOT (is_won_stage AND is_lost_stage));
  END IF;
END $$;

-- At most one won stage, and at most one lost stage, per pipeline —
-- same partial-unique-index trick as idx_pipeline_stages_one_qualified_per_pipeline.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pipeline_stages_one_won_per_pipeline
  ON pipeline_stages (pipeline_id)
  WHERE is_won_stage;
CREATE UNIQUE INDEX IF NOT EXISTS idx_pipeline_stages_one_lost_per_pipeline
  ON pipeline_stages (pipeline_id)
  WHERE is_lost_stage;

-- Best-effort default: the seeded default pipeline (see
-- SPEC_DEFAULT_STAGES in pipelines/page.tsx) always names its last
-- stage "Won" — flag it automatically so existing accounts get
-- working won-sync without a trip to Settings. Only touches a
-- pipeline that doesn't already have a won stage set, so this is
-- safe to re-run and never overrides anything an admin already chose.
UPDATE pipeline_stages ps
SET is_won_stage = true
WHERE lower(ps.name) = 'won'
  AND NOT EXISTS (
    SELECT 1 FROM pipeline_stages other
    WHERE other.pipeline_id = ps.pipeline_id AND other.is_won_stage
  );
-- No equivalent backfill for "lost" — there's no seeded lost stage
-- (SPEC_DEFAULT_STAGES has none), so every account picks their own
-- stage (e.g. "Perdidos") explicitly in Settings.

-- Fires on INSERT too (not just UPDATE OF stage_id) — creating a deal
-- directly inside a won/lost stage (the "+" on that stage's column)
-- needs the same sync as dragging one there later. On INSERT this
-- runs alongside set_deal_closed_at (migration 053, unconditional on
-- INSERT) — both derive closed_at from the final NEW.status they
-- agree on, so firing order between the two doesn't matter.
CREATE OR REPLACE FUNCTION sync_deal_status_from_stage()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_is_won BOOLEAN;
  v_is_lost BOOLEAN;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.stage_id IS NOT DISTINCT FROM OLD.stage_id THEN
    RETURN NEW; -- stage didn't actually change
  END IF;

  SELECT is_won_stage, is_lost_stage INTO v_is_won, v_is_lost
  FROM pipeline_stages WHERE id = NEW.stage_id;

  IF v_is_won THEN
    NEW.status := 'won';
    NEW.closed_at := NOW();
  ELSIF v_is_lost THEN
    NEW.status := 'lost';
    NEW.closed_at := NOW();
  ELSIF TG_OP = 'UPDATE' AND OLD.status IN ('won', 'lost') THEN
    -- Dragged back out of a won/lost stage into a neutral one —
    -- the stage move is the live signal here, so treat it as
    -- reopening the deal rather than leaving a stale status.
    NEW.status := 'open';
    NEW.closed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_deal_stage_changed_sync_status ON deals;
CREATE TRIGGER on_deal_stage_changed_sync_status
  BEFORE INSERT OR UPDATE OF stage_id ON deals
  FOR EACH ROW EXECUTE FUNCTION sync_deal_status_from_stage();

-- The trigger above only catches FUTURE stage moves. An admin marking
-- an existing stage as won/lost in Settings (e.g. finally checking
-- the box on the "Perdidos" stage they'd already been dragging deals
-- into) needs every deal ALREADY sitting there fixed too — that's
-- exactly the reported bug (deals visibly in "Perdidos", Lost count
-- stuck at 0). One-directional on purpose: un-marking a stage does
-- NOT reopen its deals, only marking forward-syncs them, so flipping
-- a flag off by mistake can't mass-reopen a batch of deals.
-- closed_at isn't set explicitly here either, same reasoning as the
-- backfill below: this UPDATE targets `status`, so set_deal_closed_at
-- (migration 053) stamps it on its own once status actually changes.
CREATE OR REPLACE FUNCTION sync_deals_when_stage_marked_outcome()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.is_won_stage AND NOT OLD.is_won_stage THEN
    UPDATE deals SET status = 'won' WHERE stage_id = NEW.id AND status IS DISTINCT FROM 'won';
  ELSIF NEW.is_lost_stage AND NOT OLD.is_lost_stage THEN
    UPDATE deals SET status = 'lost' WHERE stage_id = NEW.id AND status IS DISTINCT FROM 'lost';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_stage_marked_outcome_sync_deals ON pipeline_stages;
CREATE TRIGGER on_stage_marked_outcome_sync_deals
  AFTER UPDATE OF is_won_stage, is_lost_stage ON pipeline_stages
  FOR EACH ROW EXECUTE FUNCTION sync_deals_when_stage_marked_outcome();

-- Apply the same backfill retroactively right now, for the "Won"
-- stage flag this migration just set above — any deal already
-- sitting in a newly-flagged Won stage gets corrected immediately
-- rather than waiting for its next stage move. closed_at isn't set
-- here: set_deal_closed_at (migration 053) fires on this same UPDATE
-- (it targets the `status` column, which this one does touch, unlike
-- the stage-only moves above) and stamps it independently once status
-- actually changes.
UPDATE deals d
SET status = 'won'
FROM pipeline_stages ps
WHERE d.stage_id = ps.id
  AND ps.is_won_stage
  AND d.status IS DISTINCT FROM 'won';
