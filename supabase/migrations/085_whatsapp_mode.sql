-- ============================================================
-- 085_whatsapp_mode.sql — which WhatsApp setup an account uses.
--
-- Phase 3 of "multiple WhatsApp numbers per account". Two values:
--
--   'shared'       — one number for the whole team (today's only
--                    behavior, whether there's one person or a team
--                    round-robinned across it — same mechanism
--                    either way, see pickRoundRobinAgent in
--                    webhook-processor.ts). DEFAULT, and what every
--                    existing account is set to by this migration —
--                    nothing changes for anyone unless they
--                    explicitly opt into 'multiwhatsapp'.
--   'multiwhatsapp' — each seller connects their own number. Chosen
--                    up front by a brand-new account's onboarding
--                    wizard, or switched into later from Settings by
--                    an existing account. Nothing else in the schema
--                    (083/084's owner_user_id/whatsapp_config_id
--                    columns, or the per-number conversation-
--                    splitting logic a later migration adds) actually
--                    require this flag to be set — it's read by the
--                    APPLICATION as the single on/off switch for
--                    whether to show the multi-number UI and apply
--                    per-number conversation splitting, precisely so
--                    an existing 'shared' account is never affected
--                    by code that already understands multi-number
--                    accounts.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS whatsapp_mode TEXT NOT NULL DEFAULT 'shared';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'accounts_whatsapp_mode_check'
  ) THEN
    ALTER TABLE accounts
      ADD CONSTRAINT accounts_whatsapp_mode_check
      CHECK (whatsapp_mode IN ('shared', 'multiwhatsapp'));
  END IF;
END $$;
