-- ============================================================
-- 077_pipeline_followup_stage.sql — let a pipeline stage mean
-- "follow-up" (a lead that went quiet after receiving info, or said
-- "I'll check it out" and stopped responding), same shape as
-- is_qualified_stage (038) / is_won_stage / is_lost_stage (060): an
-- explicit admin-set flag on the stage, not a guess from its name or
-- position, since stages are freely renamable/reorderable/addable.
--
-- A follow-up stage is a neutral holding stage, not an outcome — it
-- must never be flagged together with won/lost on the same stage, so
-- the existing mutual-exclusion CHECK from migration 060 is replaced
-- with a wider one covering all three outcome/holding flags.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE pipeline_stages
  ADD COLUMN IF NOT EXISTS is_followup_stage BOOLEAN NOT NULL DEFAULT false;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pipeline_stages_not_both_won_and_lost'
  ) THEN
    ALTER TABLE pipeline_stages
      DROP CONSTRAINT pipeline_stages_not_both_won_and_lost;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pipeline_stages_outcome_flags_exclusive'
  ) THEN
    ALTER TABLE pipeline_stages
      ADD CONSTRAINT pipeline_stages_outcome_flags_exclusive
      CHECK (
        NOT (is_won_stage AND is_lost_stage)
        AND NOT (is_followup_stage AND is_won_stage)
        AND NOT (is_followup_stage AND is_lost_stage)
      );
  END IF;
END $$;

-- At most one follow-up stage per pipeline — same partial-unique-index
-- trick as idx_pipeline_stages_one_qualified_per_pipeline /
-- ..._one_won_per_pipeline / ..._one_lost_per_pipeline.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pipeline_stages_one_followup_per_pipeline
  ON pipeline_stages (pipeline_id)
  WHERE is_followup_stage;

-- Best-effort default for existing pipelines that already renamed a
-- stage to something like "Seguimiento" / "Follow-up" by hand, before
-- this flag existed. Only touches a pipeline that doesn't already
-- have a follow-up stage set, and skips any stage already flagged
-- won/lost/qualified — never overrides an admin's explicit choice.
UPDATE pipeline_stages ps
SET is_followup_stage = true
WHERE ps.name ~* '(seguimiento|follow.?up)'
  AND NOT ps.is_won_stage
  AND NOT ps.is_lost_stage
  AND NOT EXISTS (
    SELECT 1 FROM pipeline_stages other
    WHERE other.pipeline_id = ps.pipeline_id AND other.is_followup_stage
  );

-- No sync trigger needed here (unlike won/lost in migration 060):
-- moving a deal into or out of a follow-up stage never needs to touch
-- deals.status — sync_deal_status_from_stage() (060) already reopens
-- a deal (status='open') whenever it's moved into any stage that
-- isn't flagged won/lost, follow-up included, for free.
