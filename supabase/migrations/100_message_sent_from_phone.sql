-- ============================================================
-- 100_message_sent_from_phone.sql
--
-- Marks messages the business typed in the WhatsApp Business PHONE app
-- (Coexistence numbers bridged through Zernio: webhook `message.sent`
-- with `source = whatsapp_business_app`), so the inbox can label them and
-- the team can tell a phone reply from one sent through the CRM.
--
-- Nothing else depends on it: the message row is recorded either way, and
-- the webhook falls back to inserting without this column if the migration
-- hasn't been applied yet.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS sent_from_phone BOOLEAN NOT NULL DEFAULT false;
