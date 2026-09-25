-- ============================================================
-- 110_security_hardening.sql — database-layer fixes from the
-- 2026-09-25 full-app audit. Every check below already existed in
-- the Next.js layer (getCurrentAccount / requireRole), but the anon
-- key is public, so any signed-in user can skip the app and talk to
-- PostgREST directly with their own JWT. This migration makes the
-- database enforce the same rules.
--
--   1. accounts: status / owner_user_id / round_robin_cursor_user_id
--      can't be changed by a client (a 'pending' or 'suspended'
--      owner could PATCH their own row to status='active').
--   2. account_invitations: a client can't create/alter an 'owner'
--      invitation (an admin could self-issue one and redeem it to
--      take over the account).
--   3. remove_account_member: the personal account it spins up for a
--      removed member starts 'pending', not 'active'.
--   4. Server-only SECURITY DEFINER functions: EXECUTE revoked from
--      anon/authenticated (Supabase grants it to both by default
--      privileges, which REVOKE ... FROM PUBLIC does not undo).
--   5. RESTRICTIVE policies on every account-scoped table:
--        - account must be 'active' (089 only covered 4 tables);
--        - MFA: a user with a verified TOTP factor must hold an aal2
--          session (2FA was only enforced in the app layer).
--      accounts and profiles are deliberately excluded — same reason
--      as 089: a blocked user must still read their own account and
--      profile so /acceso-restringido and /login-mfa can render.
--   6. deals.conversation_id: ON DELETE SET NULL (deleting a contact
--      failed with 23503 whenever its deal pointed at its thread).
--   7. ensure_open_deal(): atomic "create an open deal unless the
--      contact already has one", serialized per contact with an
--      advisory lock — closes the duplicate-deal race for good.
--   8. Missing indexes on hot filters / FKs.
--
-- Idempotent — safe to re-run.
-- ============================================================

-- ------------------------------------------------------------
-- 1. accounts privilege columns
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_account_privilege_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF (NEW.status IS DISTINCT FROM OLD.status
      OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
      OR NEW.round_robin_cursor_user_id IS DISTINCT FROM OLD.round_robin_cursor_user_id)
     AND current_user = 'authenticated'
  THEN
    RAISE EXCEPTION
      'status, owner_user_id and round_robin_cursor_user_id cannot be changed directly'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.enforce_account_privilege_columns() OWNER TO postgres;

DROP TRIGGER IF EXISTS enforce_account_privilege_columns ON public.accounts;
CREATE TRIGGER enforce_account_privilege_columns
  BEFORE UPDATE ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_account_privilege_columns();

-- ------------------------------------------------------------
-- 2. owner invitations are server/RPC-only
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_invitation_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.role = 'owner' AND current_user = 'authenticated' THEN
    RAISE EXCEPTION 'owner invitations can only be issued by the agency'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.enforce_invitation_role() OWNER TO postgres;

DROP TRIGGER IF EXISTS enforce_invitation_role ON public.account_invitations;
CREATE TRIGGER enforce_invitation_role
  BEFORE INSERT OR UPDATE ON public.account_invitations
  FOR EACH ROW EXECUTE FUNCTION public.enforce_invitation_role();

-- ------------------------------------------------------------
-- 3. removed members land in a 'pending' personal account
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.remove_account_member(
  p_user_id UUID
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_account_id UUID;
  v_caller_role account_role_enum;
  v_target_account_id UUID;
  v_target_role account_role_enum;
  v_target_name TEXT;
  v_target_email TEXT;
  v_new_account_id UUID;
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

  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot remove yourself; transfer ownership or leave the account instead'
      USING ERRCODE = '22023';
  END IF;

  SELECT account_id, account_role, full_name, email
  INTO v_target_account_id, v_target_role, v_target_name, v_target_email
  FROM profiles
  WHERE user_id = p_user_id;

  IF v_target_account_id IS NULL THEN
    RAISE EXCEPTION 'Target user not found' USING ERRCODE = '22023';
  END IF;

  IF v_target_account_id <> v_caller_account_id THEN
    RAISE EXCEPTION 'Target user is not a member of your account'
      USING ERRCODE = '42501';
  END IF;

  IF v_target_role = 'owner' THEN
    RAISE EXCEPTION 'Cannot remove the account owner; transfer ownership first'
      USING ERRCODE = '22023';
  END IF;

  -- 'pending' like any self-signup (088): a removed member does not
  -- get a free, already-approved account of their own.
  INSERT INTO accounts (name, owner_user_id, status)
  VALUES (
    COALESCE(NULLIF(v_target_name, ''), v_target_email, 'My account'),
    p_user_id,
    'pending'
  )
  RETURNING id INTO v_new_account_id;

  UPDATE profiles
  SET account_id = v_new_account_id,
      account_role = 'owner'
  WHERE user_id = p_user_id;

  RETURN v_new_account_id;
END;
$$;
ALTER FUNCTION public.remove_account_member(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.remove_account_member(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_account_member(UUID) TO authenticated;

-- ------------------------------------------------------------
-- 4. server-only functions: service_role only
-- ------------------------------------------------------------
DO $$
DECLARE
  sig TEXT;
BEGIN
  FOREACH sig IN ARRAY ARRAY[
    'public._bcast_bump(uuid, text, integer)',
    'public.recompute_broadcast_counts(uuid)',
    'public.claim_ai_reply_slot(uuid, integer)',
    'public.create_agency_account_with_owner_invite(text, text, uuid, text, text, timestamptz)',
    'public.increment_automation_execution_count(uuid)',
    'public.increment_flow_execution_count(uuid)',
    'public.merge_duplicate_contacts()',
    'public.merge_duplicate_conversations()',
    'public.next_round_robin_agent(uuid)',
    'public.notify_admins_and_owners(uuid, text, uuid, uuid, text, text)',
    'public.record_webhook_failure(uuid, integer)'
  ]
  LOOP
    IF to_regprocedure(sig) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', sig);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', sig);
    ELSE
      RAISE NOTICE 'skipping missing function %', sig;
    END IF;
  END LOOP;
END;
$$;

-- ------------------------------------------------------------
-- 5. RESTRICTIVE account-active + MFA policies
-- ------------------------------------------------------------
-- True unless the caller has a verified MFA factor and their session
-- hasn't passed it (aal1). service_role / anon have no auth.uid(), so
-- they have no factors and pass. SECURITY DEFINER to read auth.mfa_factors.
CREATE OR REPLACE FUNCTION public.mfa_satisfied()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
      OR NOT EXISTS (
        SELECT 1 FROM auth.mfa_factors
        WHERE user_id = auth.uid() AND status = 'verified'
      );
$$;

ALTER FUNCTION public.mfa_satisfied() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.mfa_satisfied() FROM PUBLIC;
-- No anon grant: nothing reads these tables as anon (public booking
-- goes through the service-role client, src/lib/booking/admin-client.ts).
GRANT EXECUTE ON FUNCTION public.mfa_satisfied() TO authenticated, service_role;

DO $$
DECLARE
  t TEXT;
BEGIN
  -- Every RLS-enabled public table except the two a blocked user must
  -- still be able to read.
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relrowsecurity
      AND c.relname NOT IN ('accounts', 'profiles')
  LOOP
    -- `(SELECT ...)` makes Postgres evaluate it once per statement
    -- (initplan), not once per row.
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_mfa_required', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL
         USING ((SELECT public.mfa_satisfied()))
         WITH CHECK ((SELECT public.mfa_satisfied()))',
      t || '_mfa_required', t
    );

    -- Account-active: tables that carry account_id directly. The 4
    -- from 089 are re-created identically (same policy name).
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = t AND column_name = 'account_id'
    ) THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_account_active', t);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL
           USING (account_id IS NULL OR public.account_is_active(account_id))
           WITH CHECK (account_id IS NULL OR public.account_is_active(account_id))',
        t || '_account_active', t
      );
    END IF;
  END LOOP;
END;
$$;

-- ------------------------------------------------------------
-- 6. deals.conversation_id → ON DELETE SET NULL
-- ------------------------------------------------------------
DO $$
DECLARE
  con TEXT;
BEGIN
  SELECT c.conname INTO con
  FROM pg_constraint c
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
  WHERE c.conrelid = 'public.deals'::regclass
    AND c.contype = 'f'
    AND a.attname = 'conversation_id'
  LIMIT 1;

  IF con IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.deals DROP CONSTRAINT %I', con);
  END IF;
  ALTER TABLE public.deals
    ADD CONSTRAINT deals_conversation_id_fkey
    FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE SET NULL;
END;
$$;

-- ------------------------------------------------------------
-- 7. ensure_open_deal — atomic per-contact open-deal creation
-- ------------------------------------------------------------
-- Returns the contact's open deal id, creating it with the given
-- fields only when none exists. The advisory lock serializes
-- concurrent callers for the same contact inside this transaction,
-- so two webhook deliveries can no longer both see "none" and insert.
CREATE OR REPLACE FUNCTION public.ensure_open_deal(
  p_account_id UUID,
  p_contact_id UUID,
  p_user_id UUID,
  p_pipeline_id UUID,
  p_stage_id UUID,
  p_title TEXT,
  p_currency TEXT,
  p_conversation_id UUID DEFAULT NULL,
  p_assigned_to UUID DEFAULT NULL,
  p_value NUMERIC DEFAULT 0
) RETURNS TABLE (deal_id UUID, created BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('open_deal:' || p_contact_id::text));

  SELECT d.id INTO v_id
  FROM deals d
  WHERE d.contact_id = p_contact_id
    AND d.account_id = p_account_id
    AND d.status = 'open'
  ORDER BY d.created_at, d.id
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    RETURN QUERY SELECT v_id, FALSE;
    RETURN;
  END IF;

  INSERT INTO deals (
    account_id, user_id, pipeline_id, stage_id, contact_id,
    conversation_id, title, value, currency, status, assigned_to
  ) VALUES (
    p_account_id, p_user_id, p_pipeline_id, p_stage_id, p_contact_id,
    p_conversation_id, p_title, COALESCE(p_value, 0), p_currency, 'open', p_assigned_to
  )
  RETURNING id INTO v_id;

  RETURN QUERY SELECT v_id, TRUE;
END;
$$;

ALTER FUNCTION public.ensure_open_deal(UUID, UUID, UUID, UUID, UUID, TEXT, TEXT, UUID, UUID, NUMERIC) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.ensure_open_deal(UUID, UUID, UUID, UUID, UUID, TEXT, TEXT, UUID, UUID, NUMERIC) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_open_deal(UUID, UUID, UUID, UUID, UUID, TEXT, TEXT, UUID, UUID, NUMERIC) TO service_role;

-- ------------------------------------------------------------
-- 8. indexes
-- ------------------------------------------------------------
DO $$
DECLARE
  spec TEXT[];
BEGIN
  FOREACH spec SLICE 1 IN ARRAY ARRAY[
    ARRAY['idx_deals_contact_status',          'deals',                'contact_id',      '(contact_id, status)'],
    ARRAY['idx_deals_conversation',            'deals',                'conversation_id', '(conversation_id)'],
    ARRAY['idx_conversations_account_last_msg','conversations',        'last_message_at', '(account_id, last_message_at DESC)'],
    ARRAY['idx_contact_notes_contact',         'contact_notes',        'contact_id',      '(contact_id)'],
    ARRAY['idx_notifications_conversation',    'notifications',        'conversation_id', '(conversation_id)'],
    ARRAY['idx_ai_activity_events_contact',    'ai_activity_events',   'contact_id',      '(contact_id)'],
    ARRAY['idx_broadcast_recipients_contact',  'broadcast_recipients', 'contact_id',      '(contact_id)'],
    ARRAY['idx_promises_conversation',         'promises',             'conversation_id', '(conversation_id)'],
    ARRAY['idx_calendar_events_service',       'calendar_events',      'service_id',      '(service_id)']
  ]
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = spec[2] AND column_name = spec[3]
    ) THEN
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I %s', spec[1], spec[2], spec[4]);
    END IF;
  END LOOP;
END;
$$;
