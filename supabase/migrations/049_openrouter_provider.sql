-- ============================================================
-- 049_openrouter_provider.sql — add OpenRouter as a third AI provider
--
-- Settings > AI assistant already lets an account bring OpenAI or
-- Anthropic keys; this widens the `provider` CHECK constraints on
-- both tables that store it so 'openrouter' is accepted too. The
-- application-side dispatch (src/lib/ai/generate.ts,
-- src/lib/ai/vision.ts, src/lib/ai/transcribe.ts) already treats
-- 'openrouter' as a first-class provider — OpenRouter's Chat
-- Completions endpoint is OpenAI-compatible, so the account's main
-- chat key doubles as its own transcription key too (no separate
-- transcription_api_key needed, unlike the 'anthropic' case).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE ai_configs
  DROP CONSTRAINT IF EXISTS ai_configs_provider_check;

ALTER TABLE ai_configs
  ADD CONSTRAINT ai_configs_provider_check
  CHECK (provider IN ('openai', 'anthropic', 'openrouter'));

ALTER TABLE ai_usage_log
  DROP CONSTRAINT IF EXISTS ai_usage_log_provider_check;

ALTER TABLE ai_usage_log
  ADD CONSTRAINT ai_usage_log_provider_check
  CHECK (provider IN ('openai', 'anthropic', 'openrouter'));
