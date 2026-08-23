-- ============================================================
-- 057_calendar_events.sql — a real team calendar: calls, meetings,
-- follow-ups, and tasks, each optionally linked to a contact and/or
-- deal, with an optional reminder.
--
-- Nothing in the schema could infer "call Juana back Thursday at
-- 3pm" from existing data — this is the first place the app lets
-- someone schedule something. Shared across the account (like
-- deals/contacts today): every member can see the whole team's
-- calendar, agent+ can create/edit/delete any event. `assigned_to`
-- is informational (who owns this task), not an access boundary —
-- same posture as `deals.assigned_to`.
--
-- `assigned_to`/`created_by` reference `profiles.id` (NOT
-- `auth.users.id`), matching `deals.assigned_to` (migration 002) —
-- NOT `conversations.assigned_agent_id`, which is the other
-- convention already in this codebase and stores an auth.users id
-- directly. Anything that needs to notify the assignee has to resolve
-- profiles.id -> profiles.user_id first, same as migration 043 does
-- for deals.
--
-- Idempotent — safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS calendar_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  assigned_to UUID REFERENCES profiles(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
  type TEXT NOT NULL DEFAULT 'call'
    CHECK (type IN ('call', 'meeting', 'follow_up', 'task', 'other')),
  title TEXT NOT NULL,
  notes TEXT,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed', 'cancelled')),
  completed_at TIMESTAMPTZ,
  -- NULL = no reminder. Minutes before `starts_at` to notify.
  reminder_minutes_before INTEGER,
  -- Dedupe marker for the reminder cron scan — same idiom as
  -- conversations.hot_lead_last_alerted_message_at (migration 040).
  reminder_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_calendar_events_account_range
  ON calendar_events (account_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_calendar_events_assigned
  ON calendar_events (assigned_to, starts_at);
CREATE INDEX IF NOT EXISTS idx_calendar_events_contact
  ON calendar_events (contact_id) WHERE contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_calendar_events_deal
  ON calendar_events (deal_id) WHERE deal_id IS NOT NULL;
-- Reminder-scan hot path: only pending rows with a reminder configured
-- that hasn't fired yet.
CREATE INDEX IF NOT EXISTS idx_calendar_events_reminder_due
  ON calendar_events (starts_at)
  WHERE status = 'pending' AND reminder_minutes_before IS NOT NULL AND reminder_sent_at IS NULL;

ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;

-- Same shape as deals' policies (migration 017): any account member
-- can read the shared calendar, agent+ can write. No ownership check
-- on UPDATE/DELETE — an agent can edit any event, not just their own,
-- same as deals.
DROP POLICY IF EXISTS calendar_events_select ON calendar_events;
CREATE POLICY calendar_events_select ON calendar_events FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS calendar_events_insert ON calendar_events;
CREATE POLICY calendar_events_insert ON calendar_events FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS calendar_events_update ON calendar_events;
CREATE POLICY calendar_events_update ON calendar_events FOR UPDATE
  USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS calendar_events_delete ON calendar_events;
CREATE POLICY calendar_events_delete ON calendar_events FOR DELETE
  USING (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON calendar_events;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON calendar_events
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Full replica identity so a DELETE's realtime payload carries
-- account_id (default replica identity only logs the primary key for
-- the old row on delete) — without this, the calendar page's
-- `account_id=eq.${accountId}` realtime filter would silently drop
-- every delete event. Same reasoning as notifications (migration 027).
ALTER TABLE calendar_events REPLICA IDENTITY FULL;

-- Realtime, so a shared team calendar live-updates when a teammate
-- adds/edits/removes an event (same pattern as migration 027).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'calendar_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE calendar_events;
  END IF;
END $$;

-- Widen the notification type check so the reminder cron
-- (src/lib/notifications/event-reminders.ts) can raise one. Carries
-- forward every type accumulated since 027 (most recently widened by
-- migration 050) — dropping and recreating this constraint with a
-- short list would silently break every other notification type.
ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'conversation_assigned', 'hot_lead_unanswered', 'lead_qualified',
    'new_lead', 'lead_scored', 'new_message', 'lead_stale', 'event_reminder'
  ));
