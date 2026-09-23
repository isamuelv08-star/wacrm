-- ============================================================
-- 103_ai_provider_error_alerts.sql — tell someone when the AI's own
-- provider key stops working.
--
-- Until now a failed provider call (bad/expired key, no credits, an
-- outage) was only ever a `console.error`: every background job that
-- talks to the account's key — auto-reply, observer mode, lead
-- classification — owns its own try/catch and swallows the failure so
-- one bad turn can't break the webhook. That's the right call for a
-- SINGLE failure, but nothing distinguished "one odd blip" from "this
-- key is dead and every future message will fail exactly the same
-- way forever." From the account owner's side both look identical to
-- the round-robin assignment bug this shipped alongside — the bot
-- just goes silent, with no product signal pointing at the cause.
--
-- `ai_configs.provider_error_notified_at` tracks the last time an
-- owner/admin was alerted, so a persistent failure raises exactly one
-- notification per cooldown window (see provider-alert.ts) instead of
-- one per failing inbound message.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS provider_error_notified_at TIMESTAMPTZ;

COMMENT ON COLUMN ai_configs.provider_error_notified_at IS
  'Last time owners/admins were notified that the AI provider call is '
  'failing (bad key, no credits, outage) — throttles the alert to one '
  'per cooldown window rather than one per failing message.';

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'conversation_assigned', 'hot_lead_unanswered', 'lead_qualified', 'new_lead',
    'lead_scored', 'new_message', 'lead_stale', 'event_reminder', 'appointment_booked',
    'team_chat_mention', 'contact_note_mention', 'ai_provider_error'
  ));
