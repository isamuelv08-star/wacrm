-- ============================================================
-- 099_contact_note_mentions_and_ai_summary.sql
--
-- Two features that share this migration:
--
-- 1. @-mentions in contact notes. The Inbox sidebar and the Contacts
--    detail sheet both write to `contact_notes` (internal, never
--    customer-facing). A note can now @-mention teammates; the trigger
--    below fans out a `contact_note_mention` notification, mirroring
--    notify_team_chat_mentions (090) exactly: SECURITY DEFINER, never
--    blocks the write it is attached to.
--
-- 2. AI executive summary of a lead (`contact_ai_summaries`). One row
--    per contact, overwritten on regeneration — "what we know today",
--    not a history. Written only by the server route (service role);
--    members can read it.
--
-- Idempotent — safe to re-run.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Note mentions
-- ------------------------------------------------------------

ALTER TABLE contact_notes
  ADD COLUMN IF NOT EXISTS mentioned_user_ids UUID[] NOT NULL DEFAULT '{}',
  -- The chat the note was written from (Inbox sidebar), so the
  -- mention notification can deep-link to it. NULL when written from
  -- the Contacts sheet.
  ADD COLUMN IF NOT EXISTS conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL;

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'conversation_assigned', 'hot_lead_unanswered', 'lead_qualified', 'new_lead',
    'lead_scored', 'new_message', 'lead_stale', 'event_reminder', 'appointment_booked',
    'team_chat_mention', 'contact_note_mention'
  ));

CREATE OR REPLACE FUNCTION notify_contact_note_mentions()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_author_name TEXT;
  v_contact_name TEXT;
  v_mentioned_id UUID;
  v_link_conversation UUID;
BEGIN
  IF NEW.mentioned_user_ids IS NULL OR array_length(NEW.mentioned_user_ids, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT full_name INTO v_author_name FROM profiles WHERE user_id = NEW.user_id;
  SELECT COALESCE(NULLIF(name, ''), phone) INTO v_contact_name FROM contacts WHERE id = NEW.contact_id;

  FOREACH v_mentioned_id IN ARRAY NEW.mentioned_user_ids LOOP
    -- Same guards as notify_team_chat_mentions: never notify yourself,
    -- and never trust the client's array beyond "maybe notify this
    -- person" — skip anyone who isn't a member of this account.
    CONTINUE WHEN v_mentioned_id = NEW.user_id;
    CONTINUE WHEN NOT EXISTS (
      SELECT 1 FROM profiles WHERE user_id = v_mentioned_id AND account_id = NEW.account_id
    );

    -- Only deep-link to the chat when the mentioned teammate can
    -- actually open it. In a 'multiwhatsapp' account a non-admin only
    -- sees conversations on their own number (087) — linking them to a
    -- chat they can't see would land on an empty screen. The note
    -- itself is always visible (contacts are account-wide).
    v_link_conversation := NULL;
    IF NEW.conversation_id IS NOT NULL THEN
      SELECT c.id INTO v_link_conversation
      FROM conversations c
      WHERE c.id = NEW.conversation_id
        AND c.account_id = NEW.account_id
        AND (
          c.whatsapp_config_id IS NULL
          OR NOT EXISTS (
            SELECT 1 FROM accounts a
            WHERE a.id = c.account_id AND a.whatsapp_mode = 'multiwhatsapp'
          )
          OR EXISTS (
            SELECT 1 FROM profiles p
            WHERE p.user_id = v_mentioned_id
              AND p.account_id = c.account_id
              AND p.account_role IN ('owner', 'admin')
          )
          OR EXISTS (
            SELECT 1 FROM whatsapp_config wc
            WHERE wc.id = c.whatsapp_config_id AND wc.owner_user_id = v_mentioned_id
          )
        );
    END IF;

    INSERT INTO notifications (
      account_id, user_id, type, conversation_id, contact_id, actor_user_id, title, body
    ) VALUES (
      NEW.account_id,
      v_mentioned_id,
      'contact_note_mention',
      v_link_conversation,
      NEW.contact_id,
      NEW.user_id,
      'Note mention',
      COALESCE(v_author_name, 'Someone') || ' mentioned you in a note on '
        || COALESCE(v_contact_name, 'a contact') || ': ' || left(NEW.note_text, 140)
    );
  END LOOP;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to create note mention notifications for note %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION notify_contact_note_mentions() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_notify_contact_note_mentions ON contact_notes;
CREATE TRIGGER trg_notify_contact_note_mentions
  AFTER INSERT ON contact_notes
  FOR EACH ROW EXECUTE FUNCTION notify_contact_note_mentions();

-- ------------------------------------------------------------
-- 2. AI executive summary of a lead
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS contact_ai_summaries (
  contact_id         UUID PRIMARY KEY REFERENCES contacts(id) ON DELETE CASCADE,
  account_id         UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  summary            TEXT NOT NULL,
  -- Short bullet points (JSON array of strings) and the suggested next
  -- step for the seller. Both optional — the model only fills what the
  -- conversation actually supports.
  highlights         JSONB NOT NULL DEFAULT '[]'::jsonb,
  next_step          TEXT,
  -- Freshness: the newest message this summary was written from. The
  -- route regenerates only when a newer message exists (or the UI
  -- language changed), so opening a lead never burns a provider call
  -- when nothing changed.
  source_message_id  UUID REFERENCES messages(id) ON DELETE SET NULL,
  source_message_at  TIMESTAMPTZ,
  language           TEXT,
  generated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contact_ai_summaries_account
  ON contact_ai_summaries (account_id);

ALTER TABLE contact_ai_summaries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contact_ai_summaries_select ON contact_ai_summaries;
CREATE POLICY contact_ai_summaries_select ON contact_ai_summaries FOR SELECT
  USING (is_account_member(account_id));

-- No INSERT/UPDATE/DELETE policy for `authenticated`: written only by
-- POST /api/contacts/[id]/summary through the service role, same
-- posture as contact_intelligence (094).

-- The summary call is logged on the account's BYO key like every other
-- LLM call — widen the mode CHECK (last set in 092) with 'lead_summary'.
ALTER TABLE ai_usage_log DROP CONSTRAINT IF EXISTS ai_usage_log_mode_check;
ALTER TABLE ai_usage_log
  ADD CONSTRAINT ai_usage_log_mode_check
  CHECK (mode IN ('auto_reply', 'draft', 'classify', 'promise_extract', 'lead_summary'));
