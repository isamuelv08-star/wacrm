-- ============================================================
-- 045_new_message_notifications.sql — notify on every inbound
-- customer message
--
-- Unlike 027/043/044, this one is populated from application code
-- (src/lib/notifications/new-message-alert.ts, called from
-- webhook-processor.ts's processMessage) rather than a DB trigger —
-- the webhook handler already has every field it needs (account,
-- conversation, contact, assignee, message preview) in scope right
-- where the message is inserted, so a trigger would just re-fetch
-- what's already sitting in memory. This migration only needs to
-- widen the notifications.type CHECK constraint to admit the new
-- value.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'conversation_assigned', 'hot_lead_unanswered', 'lead_qualified',
    'new_lead', 'lead_scored', 'new_message'
  ));
