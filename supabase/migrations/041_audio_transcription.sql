-- ============================================================
-- 041_audio_transcription.sql — automatic voice-note transcription
--
-- Adds ai_configs.transcription_api_key: an OPTIONAL OpenRouter API key
-- (AES-256-GCM-encrypted at rest, same as api_key/embeddings_api_key),
-- used only when the account's main AI provider is NOT OpenAI.
--
-- Hybrid design (see src/lib/ai/transcribe.ts):
--   - provider = 'openai'   → transcribe directly against OpenAI's own
--     Whisper endpoint using the account's EXISTING api_key. Zero extra
--     setup, no OpenRouter fee.
--   - provider = 'anthropic' (no native transcription API) → fall back
--     to this optional key against OpenRouter's unified
--     /api/v1/audio/transcriptions endpoint, so these accounts aren't
--     left out of the feature entirely.
--   - Neither available → voice notes stay untranscribed, exactly like
--     today.
--
-- The transcript itself needs no new column: it's stored in the
-- existing messages.content_text on the audio message's own row
-- (content_type stays 'audio'), the same way every other media type
-- (image/video/location) already reuses content_text as a caption.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS transcription_api_key TEXT;
