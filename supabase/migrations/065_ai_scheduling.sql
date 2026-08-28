-- ============================================================
-- 065_ai_scheduling.sql
--
-- Lets the AI auto-reply bot put an entry on the calendar itself
-- whenever a reply makes a concrete future commitment to the customer
-- — "someone will call you tomorrow at 10", "your appointment is
-- confirmed for Friday at 3pm". Before this, that promise lived only
-- in the WhatsApp thread and nothing tracked it, so it was easy for a
-- human teammate to drop. Uses the same "sentinel tag in the raw
-- model output, parsed + stripped before the customer sees it"
-- protocol as sales mode ([[STAGE:...]] etc.) — see
-- `[[SCHEDULE:...]]` in src/lib/ai/defaults.ts, applied by
-- src/lib/ai/scheduling-actions.ts.
--
-- Two columns:
--
--   ai_configs.ai_scheduling_enabled — opt-in switch (default false,
--     same posture as sales_mode_enabled): an account has to turn
--     this on deliberately, both because it's a new autonomous write
--     (not just a text field) and because it depends on
--     accounts.timezone below being set correctly first.
--
--   accounts.timezone — an IANA zone name (validated app-side with
--     isValidTimezone, src/lib/automations/schedule.ts), needed to
--     turn a relative phrase like "tomorrow at 10" into the right
--     absolute UTC instant. Nothing in this app stored an
--     account-wide timezone before now (see event-reminders.ts's
--     long-standing note on this exact gap) — defaults to UTC so
--     existing accounts and reads keep working unchanged.
-- ============================================================

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS ai_scheduling_enabled BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'UTC';
