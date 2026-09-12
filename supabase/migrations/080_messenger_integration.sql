-- 080_messenger_integration
--
-- Adds Facebook Messenger as a second inbound/outbound channel, reusing
-- the existing contacts/conversations/messages tables (same pattern
-- WhatsApp already uses) instead of a parallel schema.
--
-- Three pieces:
--   1. conversations.platform — which channel a thread arrived on.
--      Was previously read by the client (see src/lib/inbox/platform.ts)
--      but never actually existed as a column; every row defaults to
--      'whatsapp' so nothing already in the table changes meaning.
--   2. contacts.messenger_psid — Messenger identifies a user by a
--      page-scoped id (PSID), not a phone number. Kept as its own
--      nullable column rather than repurposing `phone` (which stays
--      NOT NULL — a broad `phone` nullability change would ripple into
--      every WhatsApp-only call site that treats it as a required
--      string, which is out of scope here) so WhatsApp contacts are
--      completely unaffected.
--   3. messenger_config — one row per account, same shape as
--      whatsapp_config: Page ID + encrypted Page Access Token +
--      encrypted verify token, RLS via the same is_account_member()
--      helper migration 017 introduced for whatsapp_config.

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT 'whatsapp';

ALTER TABLE conversations
  DROP CONSTRAINT IF EXISTS conversations_platform_check;
ALTER TABLE conversations
  ADD CONSTRAINT conversations_platform_check
  CHECK (platform IN ('whatsapp', 'instagram', 'messenger'));

CREATE INDEX IF NOT EXISTS idx_conversations_platform ON conversations(platform);

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS messenger_psid TEXT;

-- One PSID maps to at most one contact per account. Partial (WHERE
-- messenger_psid IS NOT NULL) so every existing WhatsApp-only contact
-- (NULL psid) is left out of the constraint entirely — mirrors how
-- migration 022's phone_normalized unique index excludes blank values.
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_account_messenger_psid
  ON contacts(account_id, messenger_psid)
  WHERE messenger_psid IS NOT NULL;

CREATE TABLE IF NOT EXISTS messenger_config (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id            UUID NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  user_id               UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  page_id               TEXT NOT NULL,
  page_name             TEXT,
  -- Encrypted the same way whatsapp_config.access_token is (see
  -- src/lib/whatsapp/encryption.ts, reused as-is — it's a generic
  -- AES-256-GCM helper keyed off ENCRYPTION_KEY, nothing WhatsApp-
  -- specific about it despite living under src/lib/whatsapp).
  page_access_token     TEXT NOT NULL,
  verify_token          TEXT,
  status                TEXT NOT NULL DEFAULT 'disconnected' CHECK (status IN ('connected', 'disconnected')),
  connected_at          TIMESTAMPTZ,
  -- Set when POST /{page_id}/subscribed_apps last succeeded.
  subscribed_at         TIMESTAMPTZ,
  last_subscribe_error  TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A given Facebook Page can only be connected to one wacrm account on
-- this install — same reasoning as whatsapp_config's phone_number_id
-- uniqueness (migration 013): without it, two accounts claiming the
-- same page would race on every inbound webhook lookup.
CREATE UNIQUE INDEX IF NOT EXISTS idx_messenger_config_page_id
  ON messenger_config(page_id);

ALTER TABLE messenger_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS messenger_config_select ON messenger_config;
DROP POLICY IF EXISTS messenger_config_insert ON messenger_config;
DROP POLICY IF EXISTS messenger_config_update ON messenger_config;
DROP POLICY IF EXISTS messenger_config_delete ON messenger_config;

CREATE POLICY messenger_config_select ON messenger_config FOR SELECT USING (is_account_member(account_id));
CREATE POLICY messenger_config_insert ON messenger_config FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY messenger_config_update ON messenger_config FOR UPDATE USING (is_account_member(account_id, 'admin'));
CREATE POLICY messenger_config_delete ON messenger_config FOR DELETE USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON messenger_config;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON messenger_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
