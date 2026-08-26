-- ============================================================
-- 061_lead_scoring_pro.sql — lead qualification, made "pro"
--
-- Upgrades the AI lead-scoring feature (migration 038) with the
-- scaffolding for explainability, auditability, and human override:
--
--   1. contacts.lead_score_reason      — short human-readable reason
--                                        for the CURRENT score (AI or
--                                        manual).
--   2. contacts.lead_score_source      — 'ai' | 'manual': who set the
--                                        current score last.
--   3. contacts.lead_score_updated_at  — auto-maintained by trigger
--                                        below; powers a "stale, hasn't
--                                        been reassessed in a while"
--                                        read in the UI.
--   4. lead_score_history              — append-only audit trail of
--                                        every change, regardless of
--                                        which code path made it.
--   5. ai_usage_log.mode widened with 'classify' — the new standalone
--                                        classification call
--                                        (src/lib/ai/lead-classify.ts)
--                                        logs its own spend distinct
--                                        from 'auto_reply' / 'draft'.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS lead_score_reason TEXT;

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS lead_score_source TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'contacts_lead_score_source_check' AND conrelid = 'contacts'::regclass
  ) THEN
    ALTER TABLE contacts
      ADD CONSTRAINT contacts_lead_score_source_check CHECK (lead_score_source IN ('ai', 'manual'));
  END IF;
END $$;

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS lead_score_updated_at TIMESTAMPTZ;

-- ------------------------------------------------------------
-- Append-only history of every lead_score change. Written exclusively
-- by the trigger below (SECURITY DEFINER, owned by postgres — same
-- posture as ai_usage_log/033: no authenticated INSERT policy).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lead_score_history (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id   UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  old_score    TEXT,
  new_score    TEXT NOT NULL,
  reason       TEXT,
  source       TEXT NOT NULL CHECK (source IN ('ai', 'manual')),
  changed_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_score_history_contact
  ON lead_score_history (contact_id, created_at DESC);

ALTER TABLE lead_score_history ENABLE ROW LEVEL SECURITY;

-- SELECT: any account member (same visibility as the contact itself —
-- see contacts_select, migration 017).
DROP POLICY IF EXISTS lead_score_history_select ON lead_score_history;
CREATE POLICY lead_score_history_select ON lead_score_history FOR SELECT
  USING (is_account_member(account_id));

-- No INSERT/UPDATE/DELETE policy for `authenticated`: rows are written
-- only by record_lead_score_change() below, which runs SECURITY
-- DEFINER as postgres and so bypasses RLS regardless of who triggered
-- the underlying contacts UPDATE (service role or an agent's session).

-- ------------------------------------------------------------
-- Trigger: on any real change to contacts.lead_score, stamp
-- lead_score_updated_at and append one history row. BEFORE UPDATE (not
-- AFTER) so it can set NEW.lead_score_updated_at before the row lands.
-- Coexists with the existing AFTER trigger on_lead_scored (migration
-- 044) — Postgres runs both for the same UPDATE OF lead_score event.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION record_lead_score_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.lead_score IS NOT DISTINCT FROM OLD.lead_score THEN
    RETURN NEW; -- unscored, or an unchanged rewrite of the same value
  END IF;

  NEW.lead_score_updated_at := now();

  INSERT INTO lead_score_history (
    account_id, contact_id, old_score, new_score, reason, source, changed_by
  ) VALUES (
    NEW.account_id, NEW.id, OLD.lead_score, NEW.lead_score,
    NEW.lead_score_reason, COALESCE(NEW.lead_score_source, 'ai'), auth.uid()
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never let history bookkeeping block the score write itself.
  RAISE WARNING 'Failed to record lead score history for contact %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION record_lead_score_change() OWNER TO postgres;

DROP TRIGGER IF EXISTS on_lead_score_change ON contacts;
CREATE TRIGGER on_lead_score_change
  BEFORE UPDATE OF lead_score ON contacts
  FOR EACH ROW EXECUTE FUNCTION record_lead_score_change();

-- ------------------------------------------------------------
-- Widen ai_usage_log.mode for the new standalone classify call.
-- ------------------------------------------------------------
ALTER TABLE ai_usage_log
  DROP CONSTRAINT IF EXISTS ai_usage_log_mode_check;

ALTER TABLE ai_usage_log
  ADD CONSTRAINT ai_usage_log_mode_check CHECK (mode IN ('auto_reply', 'draft', 'classify'));
