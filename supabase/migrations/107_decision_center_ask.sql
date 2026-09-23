-- ============================================================
-- 107_decision_center_ask.sql — "Pregunta a Saleslid" (Centro de
-- Decisiones, Section 8).
--
-- Widens ai_usage_log.mode (last set in 106) with
-- 'decision_center_ask' — a distinct call type from
-- 'decision_center_interpretation' (that one rewords an
-- auto-generated narrative; this one answers a free-text question),
-- so usage accounting can tell the two apart.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE ai_usage_log DROP CONSTRAINT IF EXISTS ai_usage_log_mode_check;
ALTER TABLE ai_usage_log
  ADD CONSTRAINT ai_usage_log_mode_check
  CHECK (mode IN ('auto_reply', 'draft', 'classify', 'promise_extract', 'lead_summary', 'observe', 'decision_center_interpretation', 'decision_center_ask'));
