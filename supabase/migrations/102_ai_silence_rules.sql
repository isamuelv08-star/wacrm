-- ============================================================
-- 102_ai_silence_rules.sql — when the AI bot goes quiet on a thread.
--
-- Until now `dispatchInboundToAiReply` stood down on ANY conversation
-- with `assigned_agent_id` set, on the theory that "a human owns this
-- thread". But round-robin (migration 042) assigns every brand-new
-- conversation the moment the webhook creates it — before anybody has
-- read a word of it — so on an account with eligible agents the bot
-- never answered a new lead at all. The only way out was toggling
-- "Resume AI" in the inbox, which clears `assigned_agent_id`.
--
-- Two settings replace that single hard-coded rule:
--
--   ai_reply_when_assigned   — TRUE (new default): a nominal assignee
--                              no longer silences the bot. FALSE keeps
--                              the old behaviour for accounts that want
--                              assignment to mean "hands off".
--
--   ai_pause_on_agent_reply  — TRUE (new default): the moment a human
--                              actually writes in the thread (from the
--                              inbox or from the WhatsApp phone app) the
--                              bot pauses itself there, exactly as if
--                              "Take over" had been pressed. It comes
--                              back on its own when the account has
--                              `auto_resume_after_minutes` set and the
--                              seller goes quiet for that long.
--
-- Together: assignment routes a lead to a seller, a seller *replying*
-- is what takes it away from the bot.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS ai_reply_when_assigned BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS ai_pause_on_agent_reply BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN ai_configs.ai_reply_when_assigned IS
  'When true (default), the bot keeps answering even if the conversation '
  'has an assigned agent — round-robin assignment alone no longer mutes it.';

COMMENT ON COLUMN ai_configs.ai_pause_on_agent_reply IS
  'When true (default), a human agent sending a message in a conversation '
  'pauses the bot there (sets ai_autoreply_disabled + ai_paused_at), so the '
  'opt-in auto-resume scan can hand it back once the agent goes quiet.';
