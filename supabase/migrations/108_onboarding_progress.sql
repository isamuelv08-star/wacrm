-- ============================================================
-- 108_onboarding_progress.sql — persist which onboarding step the
-- account left off on
--
-- Same nullable/account-scoped shape as onboarding_completed_at
-- (063_onboarding.sql): the wizard used to always reopen at step 0
-- (useState(0), no persistence) even when the user had already
-- picked a business type or WhatsApp mode and simply closed the tab
-- — onboarding audit finding D.9. Stores the step KEY (e.g.
-- "pipeline"), not an index, since the step list isn't fixed-length
-- (the conditional "calendar" step only appears for some verticals),
-- so an index would point at the wrong step once that branch is
-- known.
--
-- NULL means "no saved progress" — a brand-new account, or one that
-- already finished/skipped onboarding (onboarding-wizard.tsx never
-- renders once onboarding_completed_at is set, so there's nothing
-- to resume).
-- ============================================================

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS onboarding_current_step TEXT;
