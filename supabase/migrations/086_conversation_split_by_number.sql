-- ============================================================
-- 086_conversation_split_by_number.sql — Phase 5 of multiple
-- WhatsApp numbers per account: let the SAME contact have a separate
-- conversation per number they've messaged, instead of always
-- collapsing into the one conversation migration 036 enforces today.
--
-- Product decision (confirmed with the account owner): if a contact
-- messages Vendedor 1's number and later also messages Vendedor 2's
-- number, those are two independent conversations — not one thread
-- two sellers both see. The CONTACT stays a single shared record
-- either way (migration 083's whatsapp_config.owner_user_id already
-- said "no duplicate contacts") — only conversations split. A closed
-- sale stays attributed to whichever seller's conversation closed it,
-- unchanged (deals.assigned_to already works this way).
--
-- Mechanism: widen the UNIQUE index from migration 036
-- (account_id, contact_id) to also include whatsapp_config_id — but
-- via COALESCE to a fixed sentinel UUID, not the raw (nullable)
-- column, specifically so this is a NO-OP for every account that
-- doesn't need splitting:
--   - A 'shared'-mode account (085) — including every account that
--     existed before this migration — has at most one real
--     whatsapp_config_id value in play, or NULL (Zernio-connected,
--     Messenger, or anything from before 084's tagging existed). A
--     raw (non-COALESCEd) nullable column in a UNIQUE index would
--     treat every NULL as distinct from every other NULL, silently
--     dropping the one-conversation-per-contact guarantee for any
--     account with untagged rows — the sentinel avoids that: every
--     NULL collapses to the SAME constant, so uniqueness still holds
--     exactly as before for these accounts.
--   - A 'multiwhatsapp'-mode account's conversations get REAL,
--     DISTINCT whatsapp_config_id values (084's tagging, populated by
--     the application code this migration ships alongside) — those
--     naturally get separate uniqueness slots per number, which is
--     the whole point.
--
-- Application code (src/lib/whatsapp/webhook-processor.ts,
-- src/lib/whatsapp/resolve-conversation.ts) only starts actually
-- querying with the number filter for a 'multiwhatsapp' account — for
-- a 'shared' account the lookup query itself is byte-for-byte what it
-- was before this phase, so nothing about this migration can change
-- behavior there even independent of the COALESCE trick.
--
-- No data migration needed: the OLD (stricter) index already
-- guaranteed zero duplicate (account_id, contact_id) pairs exist, so
-- the new (more permissive) index is trivially satisfied by every
-- existing row without touching any of them.
--
-- Idempotent — safe to re-run.
-- ============================================================

DROP INDEX IF EXISTS idx_conversations_account_contact;

CREATE UNIQUE INDEX idx_conversations_account_contact
  ON conversations (
    account_id,
    contact_id,
    COALESCE(whatsapp_config_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );
