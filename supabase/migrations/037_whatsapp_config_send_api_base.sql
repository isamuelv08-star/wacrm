-- ============================================================
-- whatsapp_config.send_api_base: per-connection override for the
-- base URL used by the 6 outbound-send helpers in
-- src/lib/whatsapp/meta-api.ts (sendTextMessage, sendMediaMessage,
-- sendTemplateMessage, sendReactionMessage, sendInteractiveButtons,
-- sendInteractiveList).
--
-- Why this exists:
--   Coexistence providers (e.g. Dualhook) register with Meta as the
--   connection's "business platform" and proxy the standard Cloud
--   API /messages shape at their own base URL. An account using one
--   of these providers needs its outbound sends to hit that base URL
--   instead of https://graph.facebook.com — but only for THIS
--   account's connection. Every other whatsapp_config row on the
--   same instance should keep sending straight to Meta.
--
--   NULL (the default) means "use Meta directly" — no behavior
--   change for existing rows or connections that never set it.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS send_api_base TEXT;
