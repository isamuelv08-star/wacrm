-- ============================================================
-- 093_leak_broken_promises_signal.sql — Fase 5, Sales Leak Detector.
--
-- Deliberately does NOT create a new table or a new dashboard: the
-- Sales Leak Detector is the SAME sales_signals/Next Best Action
-- infrastructure (fases 1 y 3) made aware of a leak type it couldn't
-- see before — a broken promise (fase 4's `promises`, status
-- 'overdue') — instead of a parallel "leaks" feature. Of the leak
-- types the original vision named (cotización sin seguimiento, lead
-- sin responder, trato estancado, promesa incumplida, lead
-- abandonado), the first four already have a signal or a notification
-- in this codebase (stalled_deals / at_risk_customers / lead_stale);
-- broken promises is the one genuinely missing piece.
--
-- Idempotente — segura de re-ejecutar.
-- ============================================================

ALTER TABLE sales_signals
  DROP CONSTRAINT IF EXISTS sales_signals_signal_type_check;

ALTER TABLE sales_signals
  ADD CONSTRAINT sales_signals_signal_type_check
  CHECK (signal_type IN (
    'forecast_gap', 'low_pipeline_coverage', 'stalled_deals',
    'win_rate_decline', 'sales_cycle_increase', 'at_risk_customers',
    'broken_promises'
  ));
