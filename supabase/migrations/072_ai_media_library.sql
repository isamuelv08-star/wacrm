-- ============================================================
-- 072_ai_media_library.sql — let the AI agent send photos/videos/docs
--
-- The auto-reply bot could already generate text and (opt-in) push a
-- calendar event, but it had no way to actually attach a file — the
-- model can't invent or fetch an arbitrary image, so instead each
-- account curates a small catalog ahead of time ("foto_llanta_205_55" →
-- an actual image + a short description) and the bot picks from that
-- catalog by name, the same "sentinel tag in the raw model output"
-- protocol as [[SCHEDULE:...]] / [[STAGE:...]] (see
-- src/lib/ai/defaults.ts's SEND_MEDIA_SENTINEL_PATTERN, applied by
-- src/lib/ai/media-actions.ts).
--
-- RLS mirrors ai_knowledge_documents (migration 030): any member reads,
-- only admin+ writes — this is settings-class content curation, same
-- bar as the knowledge base or WhatsApp config.
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_media_library (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- The exact token the model is taught to echo back in
  -- [[SEND_MEDIA: <key>]] — short, stable, and account-unique so two
  -- items never collide in the same catalog listing.
  key           text NOT NULL CHECK (key ~ '^[a-z0-9_-]{1,60}$'),
  title         text NOT NULL,
  -- Shown to the model (not the customer) so it knows when this item
  -- is relevant — e.g. "Foto del neumático 205/55 R16 en stock".
  description   text NOT NULL,
  media_kind    text NOT NULL CHECK (media_kind IN ('image', 'video', 'document')),
  media_url     text NOT NULL,
  storage_path  text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, key)
);

CREATE INDEX IF NOT EXISTS ai_media_library_account_id_idx
  ON ai_media_library (account_id);

ALTER TABLE ai_media_library ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_media_library_select ON ai_media_library;
CREATE POLICY ai_media_library_select ON ai_media_library FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS ai_media_library_insert ON ai_media_library;
CREATE POLICY ai_media_library_insert ON ai_media_library FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ai_media_library_update ON ai_media_library;
CREATE POLICY ai_media_library_update ON ai_media_library FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ai_media_library_delete ON ai_media_library;
CREATE POLICY ai_media_library_delete ON ai_media_library FOR DELETE
  USING (is_account_member(account_id, 'admin'));

CREATE OR REPLACE FUNCTION public.update_ai_media_library_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ai_media_library_updated_at ON ai_media_library;
CREATE TRIGGER ai_media_library_updated_at
  BEFORE UPDATE ON ai_media_library
  FOR EACH ROW
  EXECUTE FUNCTION public.update_ai_media_library_updated_at();

-- Opt-in switch (default off, same posture as ai_scheduling_enabled /
-- google_calendar_sync_enabled): curating a media library does not by
-- itself let the bot start sending files — an admin turns this on
-- deliberately, same reasoning as every other autonomous-write feature
-- here (it spends the business's WhatsApp conversation allowance and
-- sends on the business's behalf with no human review).
ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS media_sending_enabled BOOLEAN NOT NULL DEFAULT false;

-- ============================================================
-- Storage bucket — same account-scoped path convention as chat-media
-- (migration 023) and flow-media (migration 020):
--   ai-media-library/account-<account_id>/<timestamp>-<basename>.<ext>
-- Public so Meta/Zernio can fetch the link at send time; writes scoped
-- to account members via the path's first segment.
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'ai-media-library',
  'ai-media-library',
  TRUE,
  16777216, -- 16 MB, same universal cap as chat-media
  ARRAY[
    'image/png', 'image/jpeg', 'image/webp',
    'video/mp4', 'video/3gpp',
    'application/pdf',
    'application/vnd.ms-powerpoint',
    'application/msword',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain'
  ]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "AI media library is publicly readable" ON storage.objects;
CREATE POLICY "AI media library is publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'ai-media-library');

DROP POLICY IF EXISTS "Admins can upload AI media library files" ON storage.objects;
CREATE POLICY "Admins can upload AI media library files"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'ai-media-library'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
        AND p.account_role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "Admins can update AI media library files" ON storage.objects;
CREATE POLICY "Admins can update AI media library files"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'ai-media-library'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
        AND p.account_role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "Admins can delete AI media library files" ON storage.objects;
CREATE POLICY "Admins can delete AI media library files"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'ai-media-library'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
        AND p.account_role IN ('owner', 'admin')
    )
  );
