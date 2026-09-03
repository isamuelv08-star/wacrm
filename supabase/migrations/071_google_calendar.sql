-- ============================================================
-- 071_google_calendar.sql — Google Calendar integration
--
-- One connection per account (shared by the whole team, same posture
-- as WhatsApp/Instagram via client_zernio_accounts — not one per
-- user), storing an OAuth refresh token so the server can read/write
-- the account's Google Calendar on its own, both for the AI
-- auto-reply agent and for the CRM's own Calendar page.
--
-- Tokens are AES-256-GCM encrypted at rest with ENCRYPTION_KEY (see
-- src/lib/whatsapp/encryption.ts — a generic helper despite the
-- path), same as ai_configs.api_key and whatsapp_config's tokens.
-- RLS mirrors whatsapp_config: any account member can read the row
-- (the ciphertext is useless without ENCRYPTION_KEY, which never
-- leaves the server), only admin+ can write it.
-- ============================================================

CREATE TABLE IF NOT EXISTS google_calendar_connections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  connected_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  google_email TEXT,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ NOT NULL,
  scope TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE google_calendar_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY google_calendar_connections_select ON google_calendar_connections
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY google_calendar_connections_insert ON google_calendar_connections
  FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY google_calendar_connections_update ON google_calendar_connections
  FOR UPDATE USING (is_account_member(account_id, 'admin'));
CREATE POLICY google_calendar_connections_delete ON google_calendar_connections
  FOR DELETE USING (is_account_member(account_id, 'admin'));

-- Correlates an internal event with the Google event it was pushed to
-- (create-only sync for now — see src/lib/calendar/google-sync.ts) so
-- a later edit updates the same Google event instead of duplicating it.
ALTER TABLE calendar_events
  ADD COLUMN IF NOT EXISTS google_event_id TEXT;

-- Opt-in switch (default off, same posture as sales_mode_enabled /
-- lead_auto_assign_enabled): connecting Google Calendar in Settings
-- does NOT by itself start feeding it to the AI agent or pushing
-- manually-created events — an admin has to turn this on
-- deliberately once ai_scheduling_enabled + a connection both exist.
ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS google_calendar_sync_enabled BOOLEAN NOT NULL DEFAULT false;
