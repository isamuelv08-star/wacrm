-- ============================================================
-- 114_deal_progress_engine.sql — let the AI walk a deal through the
-- pipeline, and keep what it learns about the customer
--
-- Production showed the funnel collapsing: 85% of open deals parked in
-- "Seguimiento" (the follow-up cron moved even Proposal/Negotiation
-- deals there and the stage they had reached was lost), the AI never
-- closed a single sale, and nothing recorded who moved a deal. This
-- adds the data the turn-analysis engine (src/lib/ai/turn-analysis.ts)
-- needs:
--
--   1. pipeline_stages.ai_description — what each stage MEANS, so the
--      model can place a deal instead of guessing from a name.
--   2. deals.pre_followup_stage_id — the stage a deal was in when the
--      follow-up cron parked it; restored when the customer writes.
--   3. deals.stage_change_source + deal_stage_history.source/changed_by
--      — who moved a deal (human / ai / system), so the AI can respect
--      a human's move and the history is auditable.
--   4. ai_configs: deal_progress_enabled, deal_progress_min_confidence,
--      ai_stage_human_hold_hours.
--   5. deal_ai_assessments — every assessment, applied or not, with its
--      evidence and skip reason.
--   6. ai_activity_events: ai_stage_changed / ai_deal_won / ai_deal_lost.
--   7. contact_intelligence: more facts (city, timeline, quantity,
--      email, company) + evidence, and humans can correct it.
--   8. contact_custom_values.source — AI-filled vs manual values, so the
--      AI never overwrites what a person typed.
--   9. ai_usage_log mode 'turn_analysis'.
--
-- Idempotent — safe to re-run.
-- ============================================================

-- 1. Stage meanings -------------------------------------------------
ALTER TABLE public.pipeline_stages ADD COLUMN IF NOT EXISTS ai_description TEXT;

UPDATE public.pipeline_stages SET ai_description = CASE
  WHEN is_won_stage THEN 'The customer confirmed the purchase: paid, sent a payment receipt, made a transfer, or explicitly confirmed the order. Also when the business confirms the payment was received or the order is confirmed.'
  WHEN is_lost_stage THEN 'Clear, final rejection: the customer said they are not buying, bought elsewhere, or asked not to be contacted.'
  WHEN is_followup_stage THEN 'Not a sales step: the customer went quiet after our last message. Never choose it.'
  WHEN is_qualified_stage THEN 'The need is clear (what product, model, size or quantity) and the customer shows real buying interest.'
  WHEN name ~* '(propuesta|proposal|cotiz|presupuesto|quote|oferta)' THEN 'The business already gave a price, a quote, a proforma or concrete options.'
  WHEN name ~* '(negoci)' THEN 'The customer is discussing price, discounts, payment method, delivery, installation or asks to reserve the product.'
  WHEN name ~* '(contact)' THEN 'We replied and a conversation started, but the need is not clear yet.'
  WHEN position = 0 THEN 'First contact: we do not know yet what the customer needs.'
  ELSE NULL
END
WHERE ai_description IS NULL;

-- 2 & 3. Deals + stage history --------------------------------------
ALTER TABLE public.deals
  -- Plain UUID on purpose, NO foreign key: a second deals→pipeline_stages
  -- FK would make every existing `stage:pipeline_stages(...)` embed
  -- ambiguous (PostgREST refuses it) across the app.
  ADD COLUMN IF NOT EXISTS pre_followup_stage_id UUID,
  ADD COLUMN IF NOT EXISTS stage_change_source TEXT;

-- Deals already parked in a follow-up stage: recover the stage they came
-- from out of their stage history (the most recent move INTO follow-up).
UPDATE public.deals d
SET pre_followup_stage_id = h.from_stage_id
FROM (
  SELECT DISTINCT ON (dsh.deal_id) dsh.deal_id, dsh.from_stage_id
  FROM public.deal_stage_history dsh
  JOIN public.pipeline_stages ps ON ps.id = dsh.to_stage_id AND ps.is_followup_stage
  WHERE dsh.from_stage_id IS NOT NULL
  ORDER BY dsh.deal_id, dsh.changed_at DESC
) h
JOIN public.pipeline_stages fs ON TRUE
WHERE d.id = h.deal_id
  AND d.status = 'open'
  AND d.pre_followup_stage_id IS NULL
  AND fs.id = d.stage_id
  AND fs.is_followup_stage;

ALTER TABLE public.deal_stage_history
  ADD COLUMN IF NOT EXISTS source TEXT,
  ADD COLUMN IF NOT EXISTS changed_by UUID;

CREATE OR REPLACE FUNCTION public.record_deal_stage_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source TEXT;
BEGIN
  -- Who moved it: server-side writers tag their move via
  -- deals.stage_change_source as '<source>:<unique suffix>' (e.g.
  -- 'ai:2026-09-26T10:00:00Z') — unique per write so the reset trigger
  -- below can tell a fresh tag from a stale one. Anything else done with
  -- a user session is a human.
  v_source := COALESCE(
    NULLIF(split_part(NEW.stage_change_source, ':', 1), ''),
    CASE WHEN auth.uid() IS NOT NULL THEN 'human' ELSE 'system' END
  );
  IF TG_OP = 'INSERT' THEN
    INSERT INTO deal_stage_history (deal_id, account_id, pipeline_id, from_stage_id, to_stage_id, source, changed_by)
    VALUES (NEW.id, NEW.account_id, NEW.pipeline_id, NULL, NEW.stage_id, v_source, auth.uid());
  ELSIF NEW.stage_id IS DISTINCT FROM OLD.stage_id THEN
    INSERT INTO deal_stage_history (deal_id, account_id, pipeline_id, from_stage_id, to_stage_id, source, changed_by)
    VALUES (NEW.id, NEW.account_id, NEW.pipeline_id, OLD.stage_id, NEW.stage_id, v_source, auth.uid());
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to record deal_stage_history for deal %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.record_deal_stage_change() OWNER TO postgres;

-- A stage_change_source only describes the write that set it — clear it
-- on any later update that doesn't set it again, so a human's next drag
-- isn't recorded as the AI's.
CREATE OR REPLACE FUNCTION public.reset_deal_stage_change_source()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.stage_change_source IS NOT DISTINCT FROM OLD.stage_change_source
     AND NEW.stage_id IS DISTINCT FROM OLD.stage_id THEN
    NEW.stage_change_source := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reset_deal_stage_change_source ON public.deals;
CREATE TRIGGER reset_deal_stage_change_source
  BEFORE UPDATE ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.reset_deal_stage_change_source();

-- 4. Settings -------------------------------------------------------
ALTER TABLE public.ai_configs
  ADD COLUMN IF NOT EXISTS deal_progress_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS deal_progress_min_confidence NUMERIC NOT NULL DEFAULT 0.75,
  ADD COLUMN IF NOT EXISTS ai_stage_human_hold_hours INTEGER NOT NULL DEFAULT 24;

-- 5. Assessment log -------------------------------------------------
CREATE TABLE IF NOT EXISTS public.deal_ai_assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  deal_id UUID REFERENCES public.deals(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
  trigger TEXT NOT NULL,                 -- customer | advisor | backfill
  from_stage_id UUID,
  recommended_stage_id UUID,
  outcome TEXT,                          -- won | lost | null
  confidence NUMERIC,
  evidence JSONB,
  reason TEXT,
  applied BOOLEAN NOT NULL DEFAULT FALSE,
  skip_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_deal_ai_assessments_deal ON public.deal_ai_assessments (deal_id, created_at DESC);
ALTER TABLE public.deal_ai_assessments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deal_ai_assessments_select ON public.deal_ai_assessments;
CREATE POLICY deal_ai_assessments_select ON public.deal_ai_assessments FOR SELECT
  USING (is_account_member(account_id));

-- 6. Activity events ------------------------------------------------
ALTER TABLE public.ai_activity_events DROP CONSTRAINT IF EXISTS ai_activity_events_event_type_check;
ALTER TABLE public.ai_activity_events ADD CONSTRAINT ai_activity_events_event_type_check
  CHECK (event_type IN ('lead_scored', 'lead_qualified', 'stage_changed', 'ai_stage_changed', 'ai_deal_won', 'ai_deal_lost'));

-- 7. Customer facts -------------------------------------------------
ALTER TABLE public.contact_intelligence
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS timeline TEXT,
  ADD COLUMN IF NOT EXISTS quantity TEXT,
  ADD COLUMN IF NOT EXISTS evidence JSONB,
  ADD COLUMN IF NOT EXISTS source_message_created_at TIMESTAMPTZ;

DROP POLICY IF EXISTS contact_intelligence_update ON public.contact_intelligence;
CREATE POLICY contact_intelligence_update ON public.contact_intelligence FOR UPDATE
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

-- 8. Custom field value origin --------------------------------------
ALTER TABLE public.contact_custom_values
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 9. Usage log ------------------------------------------------------
ALTER TABLE public.ai_usage_log DROP CONSTRAINT IF EXISTS ai_usage_log_mode_check;
ALTER TABLE public.ai_usage_log ADD CONSTRAINT ai_usage_log_mode_check
  CHECK (mode IN ('auto_reply', 'draft', 'classify', 'promise_extract', 'lead_summary', 'observe',
                  'decision_center_interpretation', 'decision_center_ask', 'turn_analysis', 'learn'));
