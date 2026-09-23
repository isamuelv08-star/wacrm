-- ============================================================
-- 105_daily_insights.sql — "Saleslid detectó" / informe comercial
-- diario (Intelligence Layer, fase 1).
--
-- One column, same shape as `profiles.team_chat_last_read_at`
-- (migration 090): a per-user watermark, nullable, updated by the
-- owning user's own RLS-scoped client — no new RLS policy needed,
-- `profiles_update` (017_account_sharing.sql) already allows
-- `auth.uid() = user_id` to update any column on their own row.
--
-- Compared against "today" in the account's own timezone (not UTC
-- midnight) by the client, so the daily report popup shows at most
-- once per calendar day per manager. See
-- src/components/dashboard/daily-report-gate.tsx.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS daily_report_last_shown_at TIMESTAMPTZ;

COMMENT ON COLUMN profiles.daily_report_last_shown_at IS
  'Last time this user (an owner/admin) was shown the daily commercial '
  'report popup on login — compared against "today" in the account''s '
  'timezone, not just null-checked, so it resets once per calendar day.';
