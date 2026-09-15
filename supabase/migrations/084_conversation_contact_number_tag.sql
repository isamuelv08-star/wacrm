-- ============================================================
-- 084_conversation_contact_number_tag.sql — Phase 2 (part 1) of
-- multiple WhatsApp numbers per account: tag which number a contact/
-- conversation came through.
--
-- Purely additive, same safety story as 083: a nullable FK nobody
-- reads or writes yet (this migration ships before the application
-- code that starts populating it), so it cannot change behavior for
-- any existing account regardless of deploy/migration ordering.
--
-- Deliberately NOT changing conversations' UNIQUE(account_id,
-- contact_id) index (036) here — that's the real product question
-- this phase surfaces: if the same contact ever messages two
-- different sellers' numbers on the same account, should that be one
-- shared conversation (tagged with whichever number was most recently
-- active) or two separate ones? That changes matching behavior for
-- everyone, not just multi-number accounts, so it needs a decision
-- before touching it — this migration only adds the tag, not a new
-- uniqueness rule. Today's application code will keep setting this
-- column only on INSERT (a new contact/conversation), never on an
-- existing row, so an existing single-number account sees no change
-- at all: every row it creates just also happens to carry the (only)
-- number's id from here on.
--
-- account_id is intentionally NOT duplicated onto whatsapp_config_id's
-- FK target check — whatsapp_config already carries its own
-- account_id (enforced by the app, which only ever looks up a config
-- row scoped to the account it's stamping), so this is a plain FK,
-- not a composite one.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS whatsapp_config_id UUID REFERENCES whatsapp_config(id) ON DELETE SET NULL;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS whatsapp_config_id UUID REFERENCES whatsapp_config(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_whatsapp_config
  ON contacts(whatsapp_config_id)
  WHERE whatsapp_config_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_whatsapp_config
  ON conversations(whatsapp_config_id)
  WHERE whatsapp_config_id IS NOT NULL;
