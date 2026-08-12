-- ============================================================
-- 039_deal_stage_history.sql — audit trail of deal stage moves
--
-- Pipeline reports need "how many deals REACHED the qualified stage
-- during period X" — not just "how many are sitting there right now".
-- `deals` only stores the current `stage_id`, so there's no way to
-- answer that accurately without a history of every transition.
--
-- One row per stage placement:
--   - On INSERT into deals: from_stage_id = NULL, to_stage_id =
--     the deal's initial stage. This doubles as "deal entered this
--     pipeline at this stage, at this time" — useful on its own for
--     a "leads entered" report scoped to a specific stage.
--   - On UPDATE of deals.stage_id: from_stage_id = OLD.stage_id,
--     to_stage_id = NEW.stage_id.
--
-- System-populated only (trigger, SECURITY DEFINER) — no client
-- INSERT/UPDATE/DELETE policy. Reads are account-scoped like `deals`.
--
-- Idempotent — safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS deal_stage_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  pipeline_id UUID NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  from_stage_id UUID REFERENCES pipeline_stages(id) ON DELETE SET NULL,
  to_stage_id UUID NOT NULL REFERENCES pipeline_stages(id) ON DELETE CASCADE,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The report query this table exists for: "distinct deals that reached
-- stage S in pipeline P during [start, end]".
CREATE INDEX IF NOT EXISTS idx_deal_stage_history_pipeline_stage_changed
  ON deal_stage_history (pipeline_id, to_stage_id, changed_at);

CREATE INDEX IF NOT EXISTS idx_deal_stage_history_deal
  ON deal_stage_history (deal_id, changed_at);

ALTER TABLE deal_stage_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deal_stage_history_select ON deal_stage_history;
CREATE POLICY deal_stage_history_select ON deal_stage_history FOR SELECT
  USING (is_account_member(account_id));

-- No INSERT/UPDATE/DELETE policy for `authenticated` — rows are
-- created exclusively by the trigger below (SECURITY DEFINER), same
-- posture as the notifications table (migration 027).

CREATE OR REPLACE FUNCTION record_deal_stage_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO deal_stage_history (deal_id, account_id, pipeline_id, from_stage_id, to_stage_id)
    VALUES (NEW.id, NEW.account_id, NEW.pipeline_id, NULL, NEW.stage_id);
  ELSIF NEW.stage_id IS DISTINCT FROM OLD.stage_id THEN
    INSERT INTO deal_stage_history (deal_id, account_id, pipeline_id, from_stage_id, to_stage_id)
    VALUES (NEW.id, NEW.account_id, NEW.pipeline_id, OLD.stage_id, NEW.stage_id);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never let a history-logging failure block the actual deal write.
  RAISE WARNING 'Failed to record deal_stage_history for deal %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION record_deal_stage_change() OWNER TO postgres;

DROP TRIGGER IF EXISTS on_deal_stage_change ON deals;
CREATE TRIGGER on_deal_stage_change
  AFTER INSERT OR UPDATE OF stage_id ON deals
  FOR EACH ROW EXECUTE FUNCTION record_deal_stage_change();
