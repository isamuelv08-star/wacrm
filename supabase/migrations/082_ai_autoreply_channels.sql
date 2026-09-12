-- 082_ai_autoreply_channels
--
-- Lets an account choose WHICH channels the AI auto-reply bot is
-- allowed to answer on, instead of it being implicitly "WhatsApp only"
-- (the only channel that existed when auto_reply_enabled was added).
-- Defaults to `{whatsapp}` so every existing account's behavior is
-- unchanged until someone explicitly opts Messenger in from Settings →
-- AI Assistant.
--
-- Checked in src/lib/ai/auto-reply.ts's eligibility gates (alongside
-- the master `auto_reply_enabled` switch) and read by the Messenger
-- inbound pipelines (src/lib/messenger/webhook-processor.ts) before
-- they even attempt a dispatch.
ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS autoreply_channels TEXT[] NOT NULL DEFAULT ARRAY['whatsapp']::text[];
