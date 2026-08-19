-- ============================================================
-- 048_zernio_accounts.sql — Zernio WhatsApp/Instagram OAuth connect
--
-- Backs the "Connect WhatsApp / Instagram via Zernio" flow
-- (GET /api/zernio/connect/[platform] + GET /api/zernio/callback).
-- Zernio brokers the Meta OAuth handshake for both platforms and
-- hands back a WhatsApp account id and/or an Instagram account id
-- once the customer finishes connecting in Meta's flow.
--
-- Design notes
--   - One row per account (UNIQUE(account_id)), same shape as
--     `whatsapp_config` — this instance is single-tenant-per-account
--     for Zernio, so a plain unique row (not a list) is enough.
--   - `zernio_profile_id` is the identifier Zernio itself issues via
--     POST /v1/profiles (NOT our own account id — Zernio's
--     /v1/connect rejects an id it never minted with "Invalid
--     profileId format"). /api/zernio/connect/[platform] creates the
--     profile lazily on first connect and reuses the stored value on
--     every later connect for the same account. Having it land on
--     this row (rather than needing a session) is what lets the
--     callback resolve the account without an active session (see
--     route comments).
--   - `client_name` is a display copy of `accounts.name` at connect
--     time — not kept in sync by a trigger, since Zernio only reads
--     it as a label at signup time and nothing in-app re-displays it.
--
-- RLS mirrors `api_keys` (026): any account member can read connection
-- status; only admin+ can write. In practice both API routes write
-- with the service-role client (the callback has no user session to
-- authenticate against — see route comments), so the write policies
-- below are defense-in-depth rather than the primary gate; the primary
-- gate is the admin-role check inside GET /api/zernio/connect/[platform].
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS client_zernio_accounts (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id           uuid NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  client_name          text NOT NULL,
  zernio_profile_id    text NOT NULL UNIQUE,
  whatsapp_account_id  text,
  instagram_account_id text,
  connected_at         timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_zernio_accounts_profile_id_idx
  ON client_zernio_accounts (zernio_profile_id);

ALTER TABLE client_zernio_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS client_zernio_accounts_select ON client_zernio_accounts;
CREATE POLICY client_zernio_accounts_select ON client_zernio_accounts FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS client_zernio_accounts_insert ON client_zernio_accounts;
CREATE POLICY client_zernio_accounts_insert ON client_zernio_accounts FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS client_zernio_accounts_update ON client_zernio_accounts;
CREATE POLICY client_zernio_accounts_update ON client_zernio_accounts FOR UPDATE
  USING (is_account_member(account_id, 'admin'));
