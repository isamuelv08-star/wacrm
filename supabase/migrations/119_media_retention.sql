-- ============================================================
-- 119 — Media retention: keep chat files for N days, then free the space
-- ============================================================
--
-- Every photo / video / voice note / document customers send is copied
-- into the private `inbound-media` bucket (migration 111), and every
-- file an advisor attaches lives in `chat-media`. Kept forever, that
-- fills a Storage quota (1 GB on Supabase's free plan) quickly.
--
-- `accounts.media_retention_days` (Settings → Integrations): NULL =
-- keep forever (the default — nothing is deleted until an admin picks
-- a period). Once set, the archive-media cron (src/lib/media/
-- retention.ts) deletes the stored files of messages older than that
-- and marks them `media_expired_at`; the message itself (text, caption,
-- voice-note transcript, date) stays, and the inbox shows "not
-- available" in place of the file.
--
-- Files that are reusable assets are never deleted: flow media, the AI
-- media library, and any chat-media file a message template (or a
-- newer message) still uses.
-- Idempotent.
-- ============================================================

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS media_retention_days INTEGER
  CHECK (media_retention_days IS NULL OR media_retention_days BETWEEN 7 AND 3650);

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS media_expired_at TIMESTAMPTZ;

COMMENT ON COLUMN messages.media_expired_at IS
  'Set when the retention job removed (or deliberately kept) this message''s stored file; never scanned again after that.';

-- The retention scan: old messages with media not processed yet.
CREATE INDEX IF NOT EXISTS idx_messages_media_retention
  ON messages (created_at)
  WHERE media_url IS NOT NULL AND media_expired_at IS NULL;

-- Hourly housekeeping (src/lib/maintenance/housekeeping.ts) deletes old
-- rows by date from these log tables.
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications (created_at);
CREATE INDEX IF NOT EXISTS idx_automation_logs_created ON automation_logs (created_at);
CREATE INDEX IF NOT EXISTS idx_deal_ai_assessments_created ON deal_ai_assessments (created_at);
