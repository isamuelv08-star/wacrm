-- ============================================================
-- 044_new_lead_and_score_notifications.sql — notify on two more
-- lead-lifecycle moments, complementing 043 (lead_qualified)
--
--   1. new_lead    — a brand-new lead entered the CRM: fires on the
--      first-ever deal for a contact (INSERT on `deals` where no
--      other row already exists for that contact_id). Covers every
--      entry path — the WhatsApp webhook's ensureLeadDeal, the
--      HOT-score auto-create path in lead-scoring.ts, and a manual
--      deal added from the Pipelines board — without touching any
--      app code, since "does another deal already exist for this
--      contact" is answerable purely from the row being inserted.
--   2. lead_scored — the AI (re)evaluated a lead's HOT/WARM/COLD
--      score: fires on `contacts.lead_score` actually changing value
--      (not on a same-value rewrite, which applyLeadScore performs
--      unconditionally every scored turn).
--
-- Both follow the same notify-the-assignee-else-every-owner/admin
-- shape as notify_conversation_assigned (027) and
-- notify_deal_qualified (043); new_lead always goes to owners/admins
-- since a fresh deal has no assignee yet at INSERT time.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'conversation_assigned', 'hot_lead_unanswered', 'lead_qualified',
    'new_lead', 'lead_scored'
  ));

-- ============================================================
-- Shared helper — notify every owner/admin on the account except
-- whoever's session triggered the write (auth.uid()). Service-role
-- writes (the WhatsApp webhook, the AI auto-reply bot) run with no
-- session, so auth.uid() is NULL there and nobody gets excluded.
-- ============================================================
CREATE OR REPLACE FUNCTION notify_admins_and_owners(
  p_account_id UUID,
  p_type TEXT,
  p_conversation_id UUID,
  p_contact_id UUID,
  p_title TEXT,
  p_body TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO notifications (
    account_id, user_id, type, conversation_id, contact_id, actor_user_id, title, body
  )
  SELECT
    p_account_id, p.user_id, p_type, p_conversation_id, p_contact_id, auth.uid(), p_title, p_body
  FROM profiles p
  WHERE p.account_id = p_account_id
    AND p.account_role IN ('owner', 'admin')
    AND p.user_id IS DISTINCT FROM auth.uid();
END;
$$;

ALTER FUNCTION notify_admins_and_owners(UUID, TEXT, UUID, UUID, TEXT, TEXT) OWNER TO postgres;

-- ============================================================
-- TRIGGER — notify on a brand-new lead (first deal for a contact)
-- ============================================================
CREATE OR REPLACE FUNCTION notify_new_lead()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contact_name TEXT;
BEGIN
  IF EXISTS (
    SELECT 1 FROM deals WHERE contact_id = NEW.contact_id AND id <> NEW.id
  ) THEN
    RETURN NEW; -- not this contact's first deal — a returning lead, not a new one
  END IF;

  SELECT COALESCE(NULLIF(name, ''), phone) INTO v_contact_name
  FROM contacts WHERE id = NEW.contact_id;

  PERFORM notify_admins_and_owners(
    NEW.account_id, 'new_lead', NEW.conversation_id, NEW.contact_id,
    'New lead', COALESCE(v_contact_name, 'Someone') || ' just came in as a new lead.'
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to create new-lead notification for deal %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION notify_new_lead() OWNER TO postgres;

DROP TRIGGER IF EXISTS on_new_lead ON deals;
CREATE TRIGGER on_new_lead
  AFTER INSERT ON deals
  FOR EACH ROW EXECUTE FUNCTION notify_new_lead();

-- ============================================================
-- TRIGGER — notify whenever the AI (re)scores a lead
-- ============================================================
CREATE OR REPLACE FUNCTION notify_lead_scored()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contact_name TEXT;
  v_conversation_id UUID;
  v_assigned_agent_id UUID;
  v_label TEXT;
  v_body TEXT;
BEGIN
  IF NEW.lead_score IS NULL OR NEW.lead_score IS NOT DISTINCT FROM OLD.lead_score THEN
    RETURN NEW; -- unscored, or an unchanged rewrite of the same value
  END IF;

  v_contact_name := COALESCE(NULLIF(NEW.name, ''), NEW.phone);
  v_label := CASE NEW.lead_score
    WHEN 'hot' THEN 'HOT' WHEN 'warm' THEN 'WARM' ELSE 'COLD'
  END;
  v_body := v_contact_name || ' was just scored ' || v_label || '.';

  SELECT id, assigned_agent_id INTO v_conversation_id, v_assigned_agent_id
  FROM conversations
  WHERE contact_id = NEW.id
  ORDER BY last_message_at DESC NULLS LAST
  LIMIT 1;

  IF v_assigned_agent_id IS NOT NULL THEN
    IF v_assigned_agent_id IS DISTINCT FROM auth.uid() THEN
      INSERT INTO notifications (
        account_id, user_id, type, conversation_id, contact_id, actor_user_id, title, body
      ) VALUES (
        NEW.account_id, v_assigned_agent_id, 'lead_scored', v_conversation_id, NEW.id,
        auth.uid(), 'Lead scored', v_body
      );
    END IF;
  ELSE
    PERFORM notify_admins_and_owners(
      NEW.account_id, 'lead_scored', v_conversation_id, NEW.id, 'Lead scored', v_body
    );
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to create lead-scored notification for contact %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION notify_lead_scored() OWNER TO postgres;

DROP TRIGGER IF EXISTS on_lead_scored ON contacts;
CREATE TRIGGER on_lead_scored
  AFTER UPDATE OF lead_score ON contacts
  FOR EACH ROW EXECUTE FUNCTION notify_lead_scored();
