-- ============================================================
-- 075_ai_activity_events.sql — visible "what the AI just did" feed
--
-- The AI bot already decides things silently: it scores a lead HOT/
-- WARM/COLD (lead-scoring.ts) and advances a deal into the account's
-- qualified pipeline stage (ensureDealInQualifiedStage) — both fully
-- audited in `lead_score_history` / `deal_stage_history`, but neither
-- surfaced anywhere in the UI. An admin watching a conversation has no
-- way to see "the AI just did X" as it happens.
--
-- This table is a lightweight, conversation-scoped feed of exactly
-- that: one row per notable AI decision, rendered inline in the
-- Inbox thread as a subtle system pill (see
-- src/components/inbox/ai-activity-pill.tsx).
--
-- Why a NEW table instead of inserting into `messages`
-- ------------------------------------------------------------
-- `messages` looks like the obvious place, but a huge amount of
-- existing code treats every row in it as a real conversational turn
-- and would silently misbehave with a synthetic one mixed in:
--   - buildConversationContext (lib/ai/context.ts) would feed the raw
--     event text back to the model as if the assistant had said it.
--   - loadConversationsSeries / loadResponseTime (dashboard queries)
--     would miscount it as an outgoing message or corrupt a response-
--     time sample.
--   - `sync_conversation_last_message_sender` (migration 050) would
--     overwrite `conversations.last_message_sender_type` with a non-
--     'customer' value, silently defusing the lead-staleness escalation
--     for a conversation where the customer is still actually waiting.
-- A dedicated table sidesteps all of that — nothing that already reads
-- `messages` needs to change or know this feed exists.
--
-- Written exclusively by server-side AI code paths using the service-
-- role client (same posture as `lead_score_history` / 061) — no INSERT
-- policy for `authenticated`.
--
-- Idempotent — safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_activity_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('lead_scored', 'lead_qualified')),
  -- Small, event-specific extras — e.g. {"score": "hot"} for
  -- lead_scored. Kept as JSONB rather than one column per event type
  -- so adding a new event later (handoff, scheduling, sales actions)
  -- needs no migration, just a new `event_type` value + a render case.
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_activity_events_conversation
  ON ai_activity_events (conversation_id, created_at);

ALTER TABLE ai_activity_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_activity_events_select ON ai_activity_events;
CREATE POLICY ai_activity_events_select ON ai_activity_events FOR SELECT
  USING (is_account_member(account_id));

-- No INSERT/UPDATE/DELETE policy for `authenticated` — every current
-- writer (lib/ai/lead-scoring.ts, called from the webhook's auto-reply
-- dispatch and the standalone classifier) runs on the service-role
-- admin client, which bypasses RLS entirely.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'ai_activity_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE ai_activity_events;
  END IF;
END $$;
