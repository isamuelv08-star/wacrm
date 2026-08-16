-- ============================================================
-- 043_lead_qualified_notifications.sql — notify the team when a deal
-- reaches the qualified stage
--
-- Migration 038 already moves a deal into whichever pipeline stage is
-- flagged `is_qualified_stage` (the AI auto-scoring a lead HOT, or an
-- agent dragging a card there by hand) — but nothing ever told anyone
-- it happened. Mirrors notify_conversation_assigned (migration 027):
-- a SECURITY DEFINER trigger on `deals`, notifying the deal's assignee
-- (deals.assigned_to → profiles.id, so it's resolved to the
-- auth.users.id notifications.user_id actually needs) or, if
-- unassigned, every owner/admin on the account.
--
-- Fires once per qualification: on INSERT landing directly in the
-- qualified stage (ensureDealInQualifiedStage's no-prior-deal path),
-- or on UPDATE of stage_id transitioning from a non-qualified (or
-- nonexistent) stage into the qualified one. Moving between two
-- non-qualified stages, or already sitting in the qualified stage,
-- is a no-op.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('conversation_assigned', 'hot_lead_unanswered', 'lead_qualified'));

CREATE OR REPLACE FUNCTION notify_deal_qualified()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_is_qualified BOOLEAN;
  v_old_is_qualified BOOLEAN := FALSE;
  v_contact_name TEXT;
  v_conversation_id UUID;
  v_body TEXT;
  v_recipient UUID;
BEGIN
  SELECT is_qualified_stage INTO v_new_is_qualified
  FROM pipeline_stages WHERE id = NEW.stage_id;

  IF v_new_is_qualified IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    SELECT is_qualified_stage INTO v_old_is_qualified
    FROM pipeline_stages WHERE id = OLD.stage_id;
    IF v_old_is_qualified IS TRUE THEN
      RETURN NEW; -- already was in the qualified stage
    END IF;
  END IF;

  SELECT COALESCE(NULLIF(name, ''), phone) INTO v_contact_name
  FROM contacts WHERE id = NEW.contact_id;

  SELECT id INTO v_conversation_id
  FROM conversations
  WHERE contact_id = NEW.contact_id
  ORDER BY last_message_at DESC NULLS LAST
  LIMIT 1;

  v_body := COALESCE(v_contact_name, 'A lead') || ' just qualified — ' || NEW.title;

  IF NEW.assigned_to IS NOT NULL THEN
    SELECT user_id INTO v_recipient FROM profiles WHERE id = NEW.assigned_to;
    IF v_recipient IS NOT NULL AND v_recipient IS DISTINCT FROM auth.uid() THEN
      INSERT INTO notifications (
        account_id, user_id, type, conversation_id, contact_id, actor_user_id, title, body
      ) VALUES (
        NEW.account_id, v_recipient, 'lead_qualified', v_conversation_id, NEW.contact_id,
        auth.uid(), 'Lead qualified', v_body
      );
    END IF;
  ELSE
    INSERT INTO notifications (
      account_id, user_id, type, conversation_id, contact_id, actor_user_id, title, body
    )
    SELECT
      NEW.account_id, p.user_id, 'lead_qualified', v_conversation_id, NEW.contact_id,
      auth.uid(), 'Lead qualified', v_body
    FROM profiles p
    WHERE p.account_id = NEW.account_id
      AND p.account_role IN ('owner', 'admin')
      AND p.user_id IS DISTINCT FROM auth.uid();
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never let a notification failure block the actual stage move.
  RAISE WARNING 'Failed to create lead-qualified notification for deal %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION notify_deal_qualified() OWNER TO postgres;

DROP TRIGGER IF EXISTS on_deal_qualified ON deals;
CREATE TRIGGER on_deal_qualified
  AFTER INSERT OR UPDATE OF stage_id ON deals
  FOR EACH ROW EXECUTE FUNCTION notify_deal_qualified();
