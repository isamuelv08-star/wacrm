-- ============================================================
-- 042_round_robin_assignment.sql — Fase A: round-robin assignment
--
-- Three independent pieces that share one migration because they're
-- all "who gets this conversation" plumbing:
--
--   1. Eligibility — profiles.round_robin_opt_in (nullable tri-state).
--      NULL means "use the role default" (agent = in, everyone else =
--      out); TRUE/FALSE is an explicit per-user override so a
--      solo-selling owner/admin can opt in, or a teammate who
--      shouldn't get leads can opt out, without inventing a new role.
--
--   2. Rotation — accounts.round_robin_cursor_user_id persists the
--      last agent who got a conversation. next_round_robin_agent()
--      advances it atomically (row lock on `accounts`, same
--      race-safety goal as claim_ai_reply_slot in 029). Ordering is
--      by (created_at, user_id) — the order teammates joined — so
--      rotation is deterministic and doesn't depend on any extra
--      bookkeeping table.
--
--   3. Notification polish — notify_conversation_assigned() (027)
--      already fires for every assignment; this just makes its
--      wording distinguish "a person assigned you" from "you were
--      auto-assigned", and surfaces a short excerpt of the AI
--      handoff summary (Fase A / part 2) when this exact UPDATE is
--      the one that set it.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- 1. Eligibility flag
-- ============================================================
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS round_robin_opt_in BOOLEAN;

COMMENT ON COLUMN profiles.round_robin_opt_in IS
  'NULL = inherit role default (agent => eligible, others => not). '
  'TRUE/FALSE = explicit override set via set_member_round_robin_opt_in.';

-- ============================================================
-- 2. Rotation cursor
-- ============================================================
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS round_robin_cursor_user_id UUID
    REFERENCES auth.users(id) ON DELETE SET NULL;

-- ============================================================
-- next_round_robin_agent(p_account_id)
--
-- Returns the next eligible agent's user_id and advances the
-- account's cursor in the same statement. Returns NULL when the
-- account has no eligible agents (e.g. a solo owner) — callers treat
-- that exactly like "no agent resolved" and leave the conversation
-- unassigned, same as today.
--
-- Race-safety: `FOR UPDATE` locks the accounts row for the duration
-- of the function call, so two concurrent inbound webhooks (or a
-- webhook racing an AI handoff) for the same account serialize
-- instead of both reading the same cursor and picking the same agent.
-- ============================================================
CREATE OR REPLACE FUNCTION public.next_round_robin_agent(
  p_account_id UUID
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_last_user_id UUID;
  v_last_created_at TIMESTAMPTZ;
  v_next UUID;
BEGIN
  PERFORM 1 FROM accounts WHERE id = p_account_id FOR UPDATE;

  SELECT round_robin_cursor_user_id INTO v_last_user_id
  FROM accounts WHERE id = p_account_id;

  IF v_last_user_id IS NOT NULL THEN
    SELECT created_at INTO v_last_created_at
    FROM profiles
    WHERE user_id = v_last_user_id AND account_id = p_account_id;
  END IF;

  -- First eligible agent strictly after the cursor.
  SELECT user_id INTO v_next
  FROM profiles
  WHERE account_id = p_account_id
    AND COALESCE(round_robin_opt_in, account_role = 'agent')
    AND (
      v_last_created_at IS NULL
      OR (created_at, user_id) > (v_last_created_at, v_last_user_id)
    )
  ORDER BY created_at ASC, user_id ASC
  LIMIT 1;

  -- Wrap around: cursor was the last in order, no longer eligible, or
  -- this is the first assignment ever for this account.
  IF v_next IS NULL THEN
    SELECT user_id INTO v_next
    FROM profiles
    WHERE account_id = p_account_id
      AND COALESCE(round_robin_opt_in, account_role = 'agent')
    ORDER BY created_at ASC, user_id ASC
    LIMIT 1;
  END IF;

  IF v_next IS NOT NULL THEN
    UPDATE accounts SET round_robin_cursor_user_id = v_next
    WHERE id = p_account_id;
  END IF;

  RETURN v_next;
END;
$$;

ALTER FUNCTION public.next_round_robin_agent(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.next_round_robin_agent(UUID) FROM PUBLIC;
-- Called from the webhook, the AI auto-reply bot, and the automations
-- engine — all three run under the service-role client (no
-- auth.uid()). Mirrors claim_ai_reply_slot's grant in 029.
GRANT EXECUTE ON FUNCTION public.next_round_robin_agent(UUID) TO service_role;

-- ============================================================
-- set_member_round_robin_opt_in(p_user_id, p_opt_in)
--
-- Admin+ sets a teammate's round-robin override (or their own — no
-- self-target restriction here, unlike set_member_role, since opting
-- yourself in/out carries no privilege-lockout risk). p_opt_in NULL
-- resets to the role default.
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_member_round_robin_opt_in(
  p_user_id UUID,
  p_opt_in BOOLEAN
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_account_id UUID;
  v_caller_role account_role_enum;
  v_target_account_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT account_id, account_role
  INTO v_caller_account_id, v_caller_role
  FROM profiles
  WHERE user_id = auth.uid();

  IF v_caller_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no account' USING ERRCODE = '42501';
  END IF;

  IF v_caller_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'This action requires the admin role or higher'
      USING ERRCODE = '42501';
  END IF;

  SELECT account_id INTO v_target_account_id
  FROM profiles WHERE user_id = p_user_id;

  IF v_target_account_id IS NULL THEN
    RAISE EXCEPTION 'Target user not found' USING ERRCODE = '22023';
  END IF;

  IF v_target_account_id <> v_caller_account_id THEN
    RAISE EXCEPTION 'Target user is not a member of your account'
      USING ERRCODE = '42501';
  END IF;

  UPDATE profiles SET round_robin_opt_in = p_opt_in
  WHERE user_id = p_user_id;
END;
$$;

ALTER FUNCTION public.set_member_round_robin_opt_in(UUID, BOOLEAN) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_member_round_robin_opt_in(UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_member_round_robin_opt_in(UUID, BOOLEAN) TO authenticated;

-- ============================================================
-- 3. Notification wording + handoff-summary excerpt
--
-- Same trigger function from 027, extended:
--   - auth.uid() IS NULL (service-role write: round-robin or AI
--     handoff) now reads "You were automatically assigned..." instead
--     of "Someone assigned you...".
--   - When this exact UPDATE just set/changed ai_handoff_summary (AI
--     handoff, part 2 of Fase A), a short excerpt is appended so the
--     agent sees why the AI handed off without opening the thread.
--     Guarded with IS DISTINCT FROM so a later, unrelated manual
--     reassignment doesn't drag in a stale summary from a prior
--     handoff.
-- ============================================================
CREATE OR REPLACE FUNCTION notify_conversation_assigned()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contact_name TEXT;
  v_actor_name TEXT;
  v_summary_excerpt TEXT;
  v_body TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.assigned_agent_id IS NULL THEN
      RETURN NEW;
    END IF;
  ELSE
    IF NEW.assigned_agent_id IS NULL
       OR NEW.assigned_agent_id IS NOT DISTINCT FROM OLD.assigned_agent_id THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Skip self-assignment — nothing to notify the agent about.
  IF auth.uid() IS NOT NULL AND auth.uid() = NEW.assigned_agent_id THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(name, ''), phone) INTO v_contact_name
  FROM contacts WHERE id = NEW.contact_id;

  IF auth.uid() IS NOT NULL THEN
    SELECT full_name INTO v_actor_name
    FROM profiles WHERE user_id = auth.uid();
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.ai_handoff_summary IS NOT NULL
     AND OLD.ai_handoff_summary IS DISTINCT FROM NEW.ai_handoff_summary THEN
    v_summary_excerpt := LEFT(NEW.ai_handoff_summary, 140);
  END IF;

  IF auth.uid() IS NULL THEN
    v_body := 'You were automatically assigned a conversation with '
      || COALESCE(v_contact_name, 'a contact');
  ELSE
    v_body := COALESCE(v_actor_name, 'Someone') || ' assigned you a conversation with '
      || COALESCE(v_contact_name, 'a contact');
  END IF;

  IF v_summary_excerpt IS NOT NULL THEN
    v_body := v_body || ' — ' || v_summary_excerpt;
  END IF;

  INSERT INTO notifications (
    account_id, user_id, type, conversation_id, contact_id,
    actor_user_id, title, body
  ) VALUES (
    NEW.account_id,
    NEW.assigned_agent_id,
    'conversation_assigned',
    NEW.id,
    NEW.contact_id,
    auth.uid(),
    'New conversation assigned',
    v_body
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never let a notification failure block the assignment itself.
  RAISE WARNING 'Failed to create assignment notification for conversation %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION notify_conversation_assigned() OWNER TO postgres;
