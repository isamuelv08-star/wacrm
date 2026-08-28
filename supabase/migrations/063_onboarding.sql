-- ============================================================
-- 063_onboarding.sql — track whether an account has been through
-- the first-run setup wizard
--
-- One column, account-scoped (not per-user): onboarding walks the
-- account owner through connecting WhatsApp, reviewing the
-- auto-seeded pipeline, optionally configuring AI, and optionally
-- inviting teammates. Once any one member finishes or explicitly
-- skips it, the whole account is considered onboarded — a teammate
-- invited afterward joins an already-set-up account and shouldn't
-- see the wizard again.
--
-- NULL means "not yet completed" (every existing account as of this
-- migration, and every new one from the moment `handle_new_user()`
-- creates its `accounts` row). Set once, never cleared — there's no
-- product reason to force a completed account back through setup.
-- ============================================================

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;
