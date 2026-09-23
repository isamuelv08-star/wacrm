-- ============================================================
-- 104_message_deleted.sql — "This message was deleted" (WhatsApp's own
-- "delete for everyone"), mirrored into the inbox.
--
-- Zernio reports it as `message.deleted` — WhatsApp-only in their event
-- list (Instagram/Messenger/Telegram also get message.edited, which
-- WhatsApp's Business Platform never forwards to anyone at all, so
-- that one isn't implemented here). See
-- src/app/api/whatsapp/webhook/zernio/route.ts's handleZernioMessageDeleted.
--
-- The original text/media stay in place — only `deleted_at` is set —
-- same posture Zernio itself takes ("the Zernio dashboard UI does not
-- show this content, but authorized API consumers may access it for
-- moderation, compliance, or archival"). The inbox bubble renders a
-- "deleted" placeholder instead of the real content once this is set;
-- see message-bubble.tsx.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

COMMENT ON COLUMN messages.deleted_at IS
  'When the sender deleted ("unsent") this message on WhatsApp. Content '
  'columns are left untouched for audit purposes; the UI renders a '
  '"deleted" placeholder instead whenever this is set.';
