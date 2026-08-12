-- ============================================================
-- 040_hot_lead_alerts.sql — alert the team when a HOT lead goes
-- unanswered by a human
--
-- Complements the AI lead-scoring from migration 038: a contact
-- scored `lead_score = 'hot'` whose last message is still unanswered
-- by a human (sender_type = 'agent' — an AI auto-reply does NOT
-- count, the goal is to get a human on it) after a configurable
-- number of minutes should raise a notification. Evaluated by a new
-- cron endpoint (GET /api/cron/hot-lead-alerts), same auth pattern as
-- the existing /api/automations/cron.
--
--   1. notifications.type — widen the CHECK to admit
--      'hot_lead_unanswered' alongside the existing
--      'conversation_assigned'.
--   2. accounts.hot_lead_alert_minutes — per-account threshold.
--      0 disables the feature for that account. Default 15.
--   3. conversations.hot_lead_last_alerted_message_at — dedupe marker:
--      the customer message we last alerted on. The cron only
--      re-alerts once a NEWER unanswered customer message exists,
--      so an ongoing silence doesn't spam a fresh notification on
--      every cron tick.
--
-- Idempotent — safe to re-run.
-- ============================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'notifications_type_check' AND conrelid = 'notifications'::regclass
  ) THEN
    ALTER TABLE notifications DROP CONSTRAINT notifications_type_check;
  END IF;
END $$;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('conversation_assigned', 'hot_lead_unanswered'));

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS hot_lead_alert_minutes INTEGER NOT NULL DEFAULT 15;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'accounts_hot_lead_alert_minutes_check' AND conrelid = 'accounts'::regclass
  ) THEN
    ALTER TABLE accounts
      ADD CONSTRAINT accounts_hot_lead_alert_minutes_check CHECK (hot_lead_alert_minutes >= 0);
  END IF;
END $$;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS hot_lead_last_alerted_message_at TIMESTAMPTZ;
