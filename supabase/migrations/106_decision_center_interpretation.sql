-- ============================================================
-- 106_decision_center_interpretation.sql — AI wording for Centro de
-- Decisiones' "Interpretación ejecutiva" section.
--
-- Widens ai_usage_log.mode (last set in 101) with
-- 'decision_center_interpretation' so the (optional, cache-bounded)
-- provider calls that reword the deterministic executive narrative
-- are visible in the usage screen, same as every other AI call type.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE ai_usage_log DROP CONSTRAINT IF EXISTS ai_usage_log_mode_check;
ALTER TABLE ai_usage_log
  ADD CONSTRAINT ai_usage_log_mode_check
  CHECK (mode IN ('auto_reply', 'draft', 'classify', 'promise_extract', 'lead_summary', 'observe', 'decision_center_interpretation'));
