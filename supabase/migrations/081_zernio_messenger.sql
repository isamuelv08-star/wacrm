-- 081_zernio_messenger
--
-- Adds Facebook Messenger as a THIRD platform connectable through the
-- existing Zernio guided-OAuth flow (client_zernio_accounts already
-- has whatsapp_account_id and instagram_account_id from migration
-- 048/056 — this is the same shape). Zernio's own vocabulary for this
-- channel is "facebook" (a Facebook Page connection), not "messenger"
-- — see src/app/api/zernio/connect/[platform]/route.ts and
-- src/app/api/zernio/callback/route.ts, which must echo the exact
-- string Zernio itself uses so the `connected={platform}` round-trip
-- matches. The app's own `conversations.platform` value stays
-- 'messenger' (migration 080) regardless of which transport
-- (Zernio-bridged or the direct Graph API connection) delivered it.
ALTER TABLE client_zernio_accounts
  ADD COLUMN IF NOT EXISTS facebook_account_id TEXT;
