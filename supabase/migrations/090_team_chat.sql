-- ============================================================
-- 090_team_chat.sql — internal team chat: one shared room per
-- account where the owner and every invited member (any role,
-- including 'viewer') can post, @-mention a teammate, and optionally
-- attach a link to a specific customer conversation. Separate from
-- the WhatsApp inbox entirely — this is team-to-team, never
-- customer-facing.
--
-- Single flat room per account (no channels/threads) — `account_id`
-- alone scopes every row, same shape as `member_presence` (024),
-- the closest existing precedent for a lightweight, account-wide,
-- informational (not CRM-operational) table.
-- ============================================================

CREATE TABLE IF NOT EXISTS team_chat_messages (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id               UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  sender_user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body                     TEXT NOT NULL,
  -- Teammates @-mentioned in `body` (by matching their full name at
  -- send time client-side — see team-chat-composer.tsx) — read by the
  -- trigger below to fan out notifications, and by the message list
  -- to highlight the matched spans without re-parsing `body`.
  mentioned_user_ids       UUID[] NOT NULL DEFAULT '{}',
  -- Optional "check out this chat" link to one customer conversation,
  -- attached via a picker in the composer rather than inline mention
  -- syntax (conversations have no short/typeable name to parse for).
  referenced_conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  deleted_at               TIMESTAMPTZ,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_team_chat_messages_account_created
  ON team_chat_messages(account_id, created_at DESC);

ALTER TABLE team_chat_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS team_chat_messages_select ON team_chat_messages;
CREATE POLICY team_chat_messages_select ON team_chat_messages FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS team_chat_messages_insert ON team_chat_messages;
CREATE POLICY team_chat_messages_insert ON team_chat_messages FOR INSERT
  WITH CHECK (is_account_member(account_id) AND sender_user_id = auth.uid());

-- Soft-delete only — the sender, or an admin+ cleaning up on someone
-- else's behalf. Column-privilege-restricted to `deleted_at` alone
-- (same belt-and-suspenders pattern as notifications.read_at,
-- migration 027) so a client can never rewrite `body`/`sender_user_id`
-- after the fact.
DROP POLICY IF EXISTS team_chat_messages_update ON team_chat_messages;
CREATE POLICY team_chat_messages_update ON team_chat_messages FOR UPDATE
  USING (is_account_member(account_id) AND (sender_user_id = auth.uid() OR is_account_member(account_id, 'admin')))
  WITH CHECK (is_account_member(account_id) AND (sender_user_id = auth.uid() OR is_account_member(account_id, 'admin')));

REVOKE UPDATE ON team_chat_messages FROM authenticated;
GRANT UPDATE (deleted_at) ON team_chat_messages TO authenticated;

-- REPLICA IDENTITY FULL: the client filters its realtime subscription
-- by `account_id=eq.<id>` (same as presence:${accountId}, migration
-- 024) — without this, a DELETE payload only carries the primary key
-- and that filter silently drops the event (see 057's header for the
-- same issue). This table uses soft-delete (UPDATE deleted_at) rather
-- than hard DELETE, but full replica identity costs nothing extra and
-- keeps the door open either way.
ALTER TABLE team_chat_messages REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'team_chat_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE team_chat_messages;
  END IF;
END $$;

-- Per-user "last read" watermark for the unread-count badge on the
-- sidebar nav item — a single column instead of a full read-receipts
-- table, same trade-off already made for presence.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS team_chat_last_read_at TIMESTAMPTZ;

-- ============================================================
-- Mentions -> notifications (mirrors notify_conversation_assigned,
-- migration 027, exactly: SECURITY DEFINER trigger, never blocks the
-- write it's attached to on failure). Widen the existing type CHECK
-- rather than adding a parallel notifications mechanism, so every
-- delivery surface team_chat_mention gets for free — the realtime
-- toast listener, the bell dropdown, and the unread badge all already
-- key off `notifications` with no per-type realtime code of their
-- own; only NewNotificationToastListener needs a new branch (app
-- code) to route this type's toast action to /team-chat instead of
-- /inbox?c=.
-- ============================================================

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'conversation_assigned', 'hot_lead_unanswered', 'lead_qualified', 'new_lead',
    'lead_scored', 'new_message', 'lead_stale', 'event_reminder', 'appointment_booked',
    'team_chat_mention'
  ));

CREATE OR REPLACE FUNCTION notify_team_chat_mentions()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sender_name TEXT;
  v_mentioned_id UUID;
BEGIN
  IF NEW.mentioned_user_ids IS NULL OR array_length(NEW.mentioned_user_ids, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT full_name INTO v_sender_name FROM profiles WHERE user_id = NEW.sender_user_id;

  FOREACH v_mentioned_id IN ARRAY NEW.mentioned_user_ids LOOP
    -- Skip mentioning yourself, and skip anyone the client claimed to
    -- mention who isn't actually a member of this account (a stale
    -- roster, a removed member, or a bogus id) — never trust the
    -- array's contents beyond "maybe notify this person".
    CONTINUE WHEN v_mentioned_id = NEW.sender_user_id;
    CONTINUE WHEN NOT EXISTS (
      SELECT 1 FROM profiles WHERE user_id = v_mentioned_id AND account_id = NEW.account_id
    );

    INSERT INTO notifications (
      account_id, user_id, type, actor_user_id, title, body
    ) VALUES (
      NEW.account_id,
      v_mentioned_id,
      'team_chat_mention',
      NEW.sender_user_id,
      'Team chat mention',
      COALESCE(v_sender_name, 'Someone') || ' mentioned you in team chat: ' || left(NEW.body, 140)
    );
  END LOOP;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to create team chat mention notifications for message %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION notify_team_chat_mentions() OWNER TO postgres;

DROP TRIGGER IF EXISTS on_team_chat_message_mentions ON team_chat_messages;
CREATE TRIGGER on_team_chat_message_mentions
  AFTER INSERT ON team_chat_messages
  FOR EACH ROW EXECUTE FUNCTION notify_team_chat_mentions();
