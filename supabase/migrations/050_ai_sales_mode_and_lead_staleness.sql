-- ============================================================
-- 050_ai_sales_mode_and_lead_staleness.sql
--
-- Two features:
--
--   1. AI "sales mode" — an opt-in extension of the existing AI
--      auto-reply bot (migration 038's qualification flow) that lets
--      the model actively drive a lead through the pipeline as it
--      converses: move the deal to a named stage, mark it won/lost,
--      and keep a running one-line summary for the deal card. Uses
--      the same "sentinel tag in the raw model output, parsed and
--      stripped before the customer sees it" protocol as
--      [[HANDOFF]]/[[SCORE:...]] — see src/lib/ai/defaults.ts.
--
--   2. Lead-staleness escalation — a dynamic "how long has this lead
--      been waiting on us" read on the pipeline deal card, with
--      notifications at increasing severity as the silence grows.
--      Needs to know, for a deal's conversation, who sent the last
--      message and when. `last_message_at` already exists
--      (denormalized onto `conversations` by application code at
--      every send path); `last_message_sender_type` is new here and
--      kept in sync by a trigger instead of touching every one of
--      those call sites (webhook, manual send, flows, automations —
--      see conversations.last_message_at's usages), so it can never
--      drift regardless of which path inserts the message.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS sales_mode_enabled BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS ai_summary TEXT;

-- ------------------------------------------------------------
-- Denormalized "who sent the last message" — kept in sync by trigger
-- rather than application code, so every message-insert path (webhook,
-- manual send, flows, automations, templates) stays correct for free.
-- ------------------------------------------------------------
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS last_message_sender_type TEXT;

-- Escalation-tier dedup, same shape as hot_lead_last_alerted_message_at
-- (migration 040) but tracking a tier (0-4) instead of a single
-- threshold, so the sweep can notify again as the SAME silence crosses
-- each higher tier without re-notifying at a tier already alerted.
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS stale_alert_tier SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS stale_alert_message_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION sync_conversation_last_message_sender()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE conversations
  SET last_message_sender_type = NEW.sender_type
  WHERE id = NEW.conversation_id;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never let this side-channel sync block the message insert itself.
  RAISE WARNING 'Failed to sync last_message_sender_type for conversation %: %', NEW.conversation_id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION sync_conversation_last_message_sender() OWNER TO postgres;

DROP TRIGGER IF EXISTS on_message_insert_sync_sender ON messages;
CREATE TRIGGER on_message_insert_sync_sender
  AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION sync_conversation_last_message_sender();

-- ------------------------------------------------------------
-- Widen the notifications type check for the new staleness alert.
-- ------------------------------------------------------------
ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'conversation_assigned', 'hot_lead_unanswered', 'lead_qualified',
    'new_lead', 'lead_scored', 'new_message', 'lead_stale'
  ));
