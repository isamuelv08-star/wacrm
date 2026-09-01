-- ============================================================
-- 068_ai_auto_resume.sql — optionally bring the AI bot back on its own
-- after a handoff nobody picks up.
--
-- Today a handoff (dispatchInboundToAiReply, when the model emits
-- [[HANDOFF]] or has nothing to say) sets conversations.ai_autoreply_
-- disabled = true and is sticky forever — only a human clicking
-- "Resume AI" in the inbox banner turns it back on. For a solo
-- operator (or any account without someone watching the inbox
-- constantly), that can strand a customer indefinitely even though
-- the per-conversation reply cap was explicitly set to "never stop" —
-- the cap and the handoff are two independent gates (see auto-reply.ts's
-- doc comment), and this migration adds an opt-in bridge between them:
-- if nobody (human) responds within N minutes, hand the thread back to
-- the bot automatically.
--
--   - ai_configs.auto_resume_after_minutes — per-account opt-in
--     (NULL, the default, means "off" — behavior is unchanged unless an
--     account explicitly turns this on, same off-by-default posture as
--     every other AI toggle in this table).
--   - conversations.ai_paused_at — WHEN the current pause started.
--     Written ONLY by the AI's own handoff path (dispatchInboundToAiReply
--     in src/lib/ai/auto-reply.ts) — every explicit human action through
--     the inbox toggle (POST /api/ai/autoreply/[conversationId], both the
--     "Take over" and "Resume AI" branches) clears it back to NULL. This
--     makes ai_paused_at IS NOT NULL the single, reliable signal for "the
--     bot paused itself and no human has acted on it yet" — the auto-
--     resume scan (src/lib/ai/auto-resume.ts) only ever touches
--     conversations matching that, so it can never override a human who
--     explicitly took over or explicitly paused the bot.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS auto_resume_after_minutes integer
    CHECK (auto_resume_after_minutes IS NULL OR auto_resume_after_minutes BETWEEN 1 AND 1440);

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS ai_paused_at timestamptz;
