-- ============================================================
-- 083_multi_whatsapp_lines.sql — Phase 1 of "multiple WhatsApp
-- numbers per account" (one number per seller/agent instead of one
-- shared number for the whole team).
--
-- This migration is PURE SCHEMA — additive only, and inert until a
-- later phase's application code starts writing/reading the new
-- columns. Nothing here changes the meaning of any existing row, and
-- no existing query anywhere in the app references the new columns,
-- so this is safe to run at any time relative to a deploy in either
-- direction (old code + new schema, or new schema + not-yet-deployed
-- code both behave exactly as before).
--
-- What changes and why:
--
--   1. whatsapp_config (direct Meta Cloud API connections) drops its
--      UNIQUE(account_id) constraint from migration 017. That
--      constraint is *why* an account can only ever have one
--      directly-connected number today — dropping it doesn't create
--      a second row for anyone (nothing inserts one yet), it just
--      stops preventing it once a later phase's connect flow does.
--      UNIQUE(phone_number_id) (migration 013) stays exactly as-is:
--      a real WhatsApp number must still map to exactly one config
--      row app-wide, multi-number-per-account or not — two accounts
--      (or two rows) can never both claim the same number.
--
--      New columns:
--        - owner_user_id — which seller/agent this specific number
--          belongs to. NULL means "the account's shared/default
--          number" (every row created before this migration, and any
--          new row a later phase doesn't explicitly assign, reads
--          this way) — so a single-seller account behaves exactly as
--          it does today with zero migration of existing data
--          required.
--        - label — a short display name for the number ("Vendedor 1",
--          "Ventas Norte", ...) shown wherever a later phase lists an
--          account's numbers. NULL is fine; the UI falls back to the
--          phone number itself.
--
--   2. New table client_zernio_channels — Zernio-connected numbers
--      (WhatsApp, Instagram, or a Facebook Page/Messenger), one row
--      per connected channel instead of the single scalar
--      whatsapp_account_id/instagram_account_id/facebook_account_id
--      columns on client_zernio_accounts (048). Zernio's own API
--      already models this as one profile -> many connected accounts
--      (see @zernio/node's accounts.listAccounts /
--      connect.listWhatsAppPhoneNumbers) — our schema just hadn't
--      caught up. client_zernio_accounts itself is untouched here:
--      it keeps owning the one-per-account zernio_profile_id (the
--      Zernio "workspace" a business's numbers live under), while
--      this new table holds the (potentially many) individual
--      channels connected into that workspace. A later phase migrates
--      any existing whatsapp_account_id/instagram_account_id/
--      facebook_account_id value into a row here and repoints the
--      webhook/connect routes at this table — not done yet, so those
--      columns keep being the live source of truth until then.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE whatsapp_config
  DROP CONSTRAINT IF EXISTS whatsapp_config_account_id_key;

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS label TEXT;

CREATE INDEX IF NOT EXISTS idx_whatsapp_config_owner_user
  ON whatsapp_config(owner_user_id)
  WHERE owner_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS client_zernio_channels (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id           UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  platform             TEXT NOT NULL CHECK (platform IN ('whatsapp', 'instagram', 'facebook')),
  -- The connected-account id Zernio itself issues (accounts.listAccounts'
  -- accountId) — globally unique the same way whatsapp_config.phone_number_id
  -- is, and for the same reason: the webhook resolves an inbound event
  -- back to one specific row by this id, so two rows claiming it would
  -- make that lookup ambiguous.
  zernio_account_id    TEXT NOT NULL UNIQUE,
  owner_user_id        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  label                TEXT,
  connected_at         TIMESTAMPTZ,
  connected_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_zernio_channels_account
  ON client_zernio_channels(account_id);

CREATE INDEX IF NOT EXISTS idx_client_zernio_channels_owner_user
  ON client_zernio_channels(owner_user_id)
  WHERE owner_user_id IS NOT NULL;

-- RLS mirrors client_zernio_accounts (048) exactly: any account member
-- can read, admin+ can write. No DELETE policy — same as 048, removing
-- a connected channel goes through the service-role client (see
-- /api/zernio/connect/[platform]'s DELETE handler), not user-session RLS.
ALTER TABLE client_zernio_channels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS client_zernio_channels_select ON client_zernio_channels;
CREATE POLICY client_zernio_channels_select ON client_zernio_channels FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS client_zernio_channels_insert ON client_zernio_channels;
CREATE POLICY client_zernio_channels_insert ON client_zernio_channels FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS client_zernio_channels_update ON client_zernio_channels;
CREATE POLICY client_zernio_channels_update ON client_zernio_channels FOR UPDATE
  USING (is_account_member(account_id, 'admin'));
