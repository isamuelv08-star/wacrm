-- ============================================================
-- 101_ai_observe_human_threads.sql — "observer" mode for the AI agent.
--
-- When on, the AI keeps reading a conversation it is NOT answering (a
-- seller took it, auto-reply was switched off there, or auto-reply is off
-- for the account) and still fills in the contact's name and drives the
-- deal — pipeline stage, won/lost, value, one-line summary — without ever
-- writing to the customer. See src/lib/ai/observer.ts.
--
-- Default false: nothing changes for any account until it opts in.
--
-- Also widens ai_usage_log.mode (last set in 099) with 'observe' so the
-- extra provider calls are visible in the usage screen.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS observe_human_threads BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE ai_usage_log DROP CONSTRAINT IF EXISTS ai_usage_log_mode_check;
ALTER TABLE ai_usage_log
  ADD CONSTRAINT ai_usage_log_mode_check
  CHECK (mode IN ('auto_reply', 'draft', 'classify', 'promise_extract', 'lead_summary', 'observe'));
