-- ============================================================
-- 038_lead_scoring.sql — configurable AI lead qualification
--
-- Each account defines its OWN criteria for what makes a lead
-- HOT/WARM/COLD (free text, business-specific — there is no universal
-- rule). The AI auto-reply bot reads those criteria, scores the lead
-- as it converses, and — when a lead becomes HOT — advances its deal
-- to whichever pipeline stage the account has designated as "the
-- qualified stage".
--
--   1. contacts.lead_score            — the AI's current read on this
--                                        contact. NULL = never scored.
--   2. ai_configs.qualification_criteria
--                                      — free-text business rules for
--                                        HOT/WARM/COLD, appended to the
--                                        system prompt only when set.
--   3. pipeline_stages.is_qualified_stage
--                                      — admin-designated "this is
--                                        where HOT leads land" marker,
--                                        one per pipeline. Stages are
--                                        fully user-renamable/reorder-
--                                        able, so this is an explicit
--                                        flag rather than a name or
--                                        position guess.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS lead_score TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'contacts_lead_score_check' AND conrelid = 'contacts'::regclass
  ) THEN
    ALTER TABLE contacts
      ADD CONSTRAINT contacts_lead_score_check CHECK (lead_score IN ('hot', 'warm', 'cold'));
  END IF;
END $$;

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS qualification_criteria TEXT;

ALTER TABLE pipeline_stages
  ADD COLUMN IF NOT EXISTS is_qualified_stage BOOLEAN NOT NULL DEFAULT false;

-- At most one qualified stage per pipeline. Partial index (only rows
-- where the flag is true) so every pipeline can freely have zero or
-- one — never two — without constraining the many `false` rows.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pipeline_stages_one_qualified_per_pipeline
  ON pipeline_stages (pipeline_id)
  WHERE is_qualified_stage;
