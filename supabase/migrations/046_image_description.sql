-- ============================================================
-- 046_image_description.sql — vision for inbound images
--
-- Adds messages.ai_image_description: a best-effort AI-generated
-- description of an inbound image, produced by src/lib/ai/vision.ts
-- right after the message row is inserted (mirrors the audio
-- transcription flow from migration 041).
--
-- Kept in its OWN column rather than reused on content_text (unlike
-- audio, which had no prior use of content_text) because an image
-- message's content_text already holds the customer's own caption when
-- they send one — overwriting that with a synthesized description would
-- destroy real customer text shown in the inbox. The description is
-- purely an internal signal so the AI (auto-reply + draft) can react to
-- what's in the photo; buildConversationContext folds it in alongside
-- the caption without touching what the human agent sees.
--
-- No provider-key changes needed: unlike transcription, both OpenAI and
-- Anthropic accept image content natively via the account's own existing
-- chat api_key, so there's no OpenRouter-style fallback column here.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS ai_image_description TEXT;
