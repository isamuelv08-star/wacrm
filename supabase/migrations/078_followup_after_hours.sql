-- ============================================================
-- 078_followup_after_hours.sql — per-account threshold for automatic
-- "move to Seguimiento" (migration 077's is_followup_stage).
--
-- accounts.followup_after_hours — hours a deal's conversation can sit
-- unanswered by the customer (last message NOT sender_type='customer')
-- before the cron (GET /api/cron/followup-stage) moves it into
-- whichever stage is flagged is_followup_stage. Same convention as
-- accounts.hot_lead_alert_minutes (migration 040): 0 disables the
-- feature for that account. Default 24 (one day) so accounts that
-- create the Seguimiento stage get working automatic follow-up without
-- a trip to Settings first.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS followup_after_hours INTEGER NOT NULL DEFAULT 24;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'accounts_followup_after_hours_check' AND conrelid = 'accounts'::regclass
  ) THEN
    ALTER TABLE accounts
      ADD CONSTRAINT accounts_followup_after_hours_check CHECK (followup_after_hours >= 0);
  END IF;
END $$;
