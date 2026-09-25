-- ============================================================
-- 111_inbound_media_archive.sql — keep customer media forever
--
-- Inbound photos / videos / voice notes / documents were never stored:
-- messages.media_url pointed at a live proxy that re-fetched from the
-- provider on every view (Meta media ids expire after ~30 days,
-- Messenger CDN URLs expire too), so old media silently stopped
-- loading in the inbox.
--
-- Now every inbound media file is copied into a PRIVATE Storage bucket
-- when it arrives (src/lib/media/archive.ts), and a backfill cron
-- (/api/cron/archive-media) catches anything the inline copy missed
-- while the provider still has it. The inbox keeps using the same
-- media_url; the serving routes check media_storage_path first and
-- redirect to a short-lived signed URL.
--
-- Private bucket with NO storage policies for authenticated/anon:
-- only the service role (server) reads or writes it, and every read
-- goes through a route that has already checked the caller can see
-- that message (RLS on messages).
--
-- Idempotent — safe to re-run.
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('inbound-media', 'inbound-media', FALSE, 104857600) -- 100 MB (Meta's document cap)
ON CONFLICT (id) DO UPDATE
SET public = FALSE,
    file_size_limit = EXCLUDED.file_size_limit;

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS media_storage_path TEXT;

COMMENT ON COLUMN public.messages.media_storage_path IS
  'Object path in the private inbound-media bucket once the file has been archived; NULL until then.';

-- Serving routes resolve a message from its proxy media_url, and the
-- backfill scans recent media rows that are not archived yet.
CREATE INDEX IF NOT EXISTS idx_messages_media_url
  ON public.messages (media_url)
  WHERE media_url IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_messages_media_unarchived
  ON public.messages (created_at DESC)
  WHERE media_url IS NOT NULL AND media_storage_path IS NULL;
