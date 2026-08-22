-- ============================================================
-- 056_zernio_whatsapp_bridge.sql — wire Zernio-connected WhatsApp
-- accounts into the real send/receive pipeline.
--
-- Until now, `client_zernio_accounts` (048) only recorded that a
-- customer finished the Meta OAuth handshake through Zernio — nothing
-- read that row to actually send or receive a message. Zernio holds
-- the Meta credentials itself and expects integrators to use ITS OWN
-- inbox API (POST /v1/inbox/conversations(/{id}/messages), the
-- message.received webhook) rather than raw Cloud API credentials —
-- so this account's WhatsApp channel can't reuse `whatsapp_config`
-- (built for direct-Meta / Dualhook-style Cloud-API-shaped access).
--
-- This migration adds two columns:
--
--   conversations.zernio_conversation_id — Zernio's own conversation
--   id. Populated the first time a thread touches Zernio (either an
--   inbound `message.received` webhook, or an outbound
--   POST /v1/inbox/conversations call) and reused after that so a
--   reply doesn't need a fresh create-conversation round trip.
--
--   client_zernio_accounts.connected_by_user_id — the admin who ran
--   the connect flow (set in /api/zernio/connect/[platform]/route.ts).
--   Every contact/conversation/message row the inbound webhook creates
--   needs a NOT NULL user_id audit FK, same as whatsapp_config.user_id
--   does for the direct-Meta path — there's no per-inbound-message
--   "user who created it", so we attribute to this stable owner,
--   mirroring the existing convention exactly.
--
-- No column is added for a per-account webhook secret — the webhook
-- subscription is created once per self-hosted instance (one Zernio
-- API key), so its signing secret lives in the `ZERNIO_WEBHOOK_SECRET`
-- env var, the same pattern `DUALHOOK_WEBHOOK_SECRET` already
-- established for the Dualhook Coexistence route.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS zernio_conversation_id TEXT;

ALTER TABLE client_zernio_accounts
  ADD COLUMN IF NOT EXISTS connected_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
