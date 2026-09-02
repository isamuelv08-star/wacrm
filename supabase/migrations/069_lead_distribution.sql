-- ============================================================
-- 069_lead_distribution.sql — auto-designación de vendedores
--
-- Three independent pieces for the "who gets this lead" flow:
--
--   1. RLS hardening — conversations_update / deals_update (017) only
--      ever checked that the ROW's account_id belongs to the caller;
--      neither had a WITH CHECK validating the *new* assignee is
--      actually a member of that account. Without an explicit WITH
--      CHECK, Postgres reuses USING for both read and write sides of
--      an UPDATE, so this was silently permissive — any signed-in
--      account member could set assigned_agent_id/assigned_to to any
--      UUID (a foreign user, or garbage). Not a cross-tenant data leak
--      (SELECT access still only ever keys off account_id, never off
--      who's assigned), but a data-integrity hole worth closing.
--
--   2. ai_configs.lead_auto_assign_enabled — opt-in switch (src/lib/ai/
--      lead-scoring.ts) for the AI to hand qualified leads to human
--      reps via the existing round-robin pool the moment a deal
--      reaches the qualified stage, day or night. Deliberately
--      independent of sales_mode_enabled: it only ever writes
--      deals.assigned_to (see point 3's doc comment for why), so an
--      account running the full-cycle AI selling agent keeps closing
--      deals itself, uninterrupted, whether or not this is also on.
--
--   3. sync_deal_owner_from_conversation — whenever a human becomes the
--      thread's handler (conversations.assigned_agent_id is set — by
--      hand, by an automation, by an AI handoff, or by the new
--      "reply = claim it" flow in send-message.ts), backfill the
--      contact's open deal's assigned_to with that same person IF it
--      doesn't already have an owner. This is what makes the pipeline
--      board (deal-card.tsx already renders deal.assignee) and the
--      manager dashboard show the right advisor without every one of
--      those call sites having to remember to do it themselves — one
--      trigger, same pattern as notify_conversation_assigned (027/042).
--      Never overwrites an existing assigned_to, so a lead the AI
--      already handed to someone overnight can't get silently
--      reassigned just because a different teammate replies to help.
--
-- Idempotent — safe to re-run.
-- ============================================================

-- ============================================================
-- 1. RLS hardening
-- ============================================================
DROP POLICY IF EXISTS conversations_update ON conversations;
CREATE POLICY conversations_update ON conversations FOR UPDATE
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (
    is_account_member(account_id, 'agent')
    AND (
      assigned_agent_id IS NULL
      OR EXISTS (
        SELECT 1 FROM profiles p
        WHERE p.user_id = assigned_agent_id AND p.account_id = account_id
      )
    )
  );

DROP POLICY IF EXISTS deals_update ON deals;
CREATE POLICY deals_update ON deals FOR UPDATE
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (
    is_account_member(account_id, 'agent')
    AND (
      assigned_to IS NULL
      OR EXISTS (
        SELECT 1 FROM profiles p
        WHERE p.id = assigned_to AND p.account_id = account_id
      )
    )
  );

-- ============================================================
-- 2. Lead auto-assign opt-in
-- ============================================================
ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS lead_auto_assign_enabled BOOLEAN NOT NULL DEFAULT false;

-- ============================================================
-- 3. Keep deals.assigned_to in sync with conversations.assigned_agent_id
-- ============================================================
CREATE OR REPLACE FUNCTION sync_deal_owner_from_conversation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_id UUID;
BEGIN
  IF NEW.assigned_agent_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.assigned_agent_id IS NOT DISTINCT FROM OLD.assigned_agent_id THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_profile_id FROM profiles WHERE user_id = NEW.assigned_agent_id;
  IF v_profile_id IS NULL THEN
    RETURN NEW; -- assignee has no profile (shouldn't happen) — nothing to sync
  END IF;

  UPDATE deals
  SET assigned_to = v_profile_id, updated_at = NOW()
  WHERE contact_id = NEW.contact_id
    AND account_id = NEW.account_id
    AND status = 'open'
    AND assigned_to IS NULL;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never let this best-effort sync block the conversation write itself.
  RAISE WARNING 'sync_deal_owner_from_conversation failed for conversation %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION sync_deal_owner_from_conversation() OWNER TO postgres;

DROP TRIGGER IF EXISTS on_conversation_assigned_sync_deal ON conversations;
CREATE TRIGGER on_conversation_assigned_sync_deal
  AFTER INSERT OR UPDATE OF assigned_agent_id ON conversations
  FOR EACH ROW EXECUTE FUNCTION sync_deal_owner_from_conversation();
