-- ============================================================
-- 052_agency_owner_invites.sql — let the agency owner create a
-- brand-new client account and invite its first user as owner,
-- reusing the existing invitation system end to end (019's
-- account_invitations / peek_invitation / redeem_invitation) instead
-- of building a parallel one.
--
-- Three changes:
--
--   1. account_invitations.role drops its `CHECK (role <> 'owner')`.
--      That check existed so a regular admin couldn't invite a
--      co-owner into THEIR OWN account (api/account/invitations/
--      route.ts's app-level validation still rejects role='owner'
--      there — unchanged). The only code path that will ever create
--      an 'owner' invitation is the new one below, itself gated by
--      requireSuperAdmin() — a completely different, unrelated
--      safeguard. Removing the DB-level check doesn't reopen the
--      member-invite flow; it only stops blocking a legitimate use
--      the check was never meant to prevent.
--
--   2. redeem_invitation() gains one line: when the redeemed
--      invitation's role is 'owner', it also updates
--      accounts.owner_user_id to the redeeming user. Every other
--      role's behavior is byte-for-byte unchanged. Without this, a
--      newly-onboarded client's profiles.account_role would correctly
--      say 'owner' but accounts.owner_user_id would keep pointing at
--      whoever created the account (the agency owner) forever.
--
--   3. New create_agency_account_with_owner_invite(...): inserts the
--      accounts row AND the account_invitations row in one function
--      call, so the two can never exist independently of each other —
--      if the invitation insert fails for any reason, the account
--      insert is rolled back with it (implicit single-transaction
--      semantics of a plpgsql function body). owner_user_id starts as
--      the calling agency owner's own id (a real, valid FK — the
--      column is NOT NULL) and self-corrects via change #2 the moment
--      the invited client redeems. GRANT EXECUTE is service_role
--      only, same posture as agency_account_overview (migration 051)
--      — nothing here is reachable by an ordinary authenticated user;
--      the actual identity check (requireSuperAdmin) lives entirely
--      in application code.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE account_invitations
  DROP CONSTRAINT IF EXISTS account_invitations_role_check;

CREATE OR REPLACE FUNCTION public.redeem_invitation(
  p_token_hash TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_inv account_invitations%ROWTYPE;
  v_old_account_id UUID;
  v_old_account_owner UUID;
  v_has_data BOOLEAN;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_inv
  FROM account_invitations
  WHERE token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found' USING ERRCODE = '22023';
  END IF;
  IF v_inv.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Invitation has already been redeemed'
      USING ERRCODE = '22023';
  END IF;
  IF v_inv.expires_at <= NOW() THEN
    RAISE EXCEPTION 'Invitation has expired' USING ERRCODE = '22023';
  END IF;

  SELECT p.account_id, a.owner_user_id
  INTO v_old_account_id, v_old_account_owner
  FROM profiles p
  JOIN accounts a ON a.id = p.account_id
  WHERE p.user_id = v_caller_id;

  IF v_old_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no profile' USING ERRCODE = '42501';
  END IF;

  IF v_old_account_id = v_inv.account_id THEN
    RAISE EXCEPTION 'You are already a member of this account'
      USING ERRCODE = '23505';
  END IF;

  IF v_old_account_owner <> v_caller_id THEN
    RAISE EXCEPTION 'You are already in a shared account; sign up with a different email to join this one'
      USING ERRCODE = '23505';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM contacts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM conversations WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM broadcasts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM automations WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM flows WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM pipelines WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM message_templates WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM tags WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM custom_fields WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM contact_notes WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM whatsapp_config WHERE account_id = v_old_account_id
    LIMIT 1
  ) INTO v_has_data;

  IF v_has_data THEN
    RAISE EXCEPTION 'Your account already contains data; sign up with a different email to join this one'
      USING ERRCODE = '23505';
  END IF;

  UPDATE profiles
  SET account_id = v_inv.account_id,
      account_role = v_inv.role
  WHERE user_id = v_caller_id;

  -- New: an owner-role invite (only ever created by the agency's
  -- create_agency_account_with_owner_invite below) hands real
  -- ownership of the target account to whoever redeems it — keeps the
  -- denormalized accounts.owner_user_id in sync with profiles.account_role.
  IF v_inv.role = 'owner' THEN
    UPDATE accounts
    SET owner_user_id = v_caller_id
    WHERE id = v_inv.account_id;
  END IF;

  UPDATE account_invitations
  SET accepted_at = NOW(),
      accepted_by_user_id = v_caller_id
  WHERE id = v_inv.id;

  DELETE FROM accounts WHERE id = v_old_account_id;

  RETURN v_inv.account_id;
END;
$$;

ALTER FUNCTION public.redeem_invitation(TEXT) OWNER TO postgres;

-- ------------------------------------------------------------
-- create_agency_account_with_owner_invite
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_agency_account_with_owner_invite(
  p_name TEXT,
  p_default_currency TEXT,
  p_agency_owner_user_id UUID,
  p_token_hash TEXT,
  p_label TEXT,
  p_expires_at TIMESTAMPTZ
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
BEGIN
  INSERT INTO accounts (name, owner_user_id, default_currency)
  VALUES (p_name, p_agency_owner_user_id, COALESCE(p_default_currency, 'USD'))
  RETURNING id INTO v_account_id;

  INSERT INTO account_invitations (
    account_id, token_hash, role, created_by_user_id, label, expires_at
  ) VALUES (
    v_account_id, p_token_hash, 'owner', p_agency_owner_user_id, p_label, p_expires_at
  );

  RETURN v_account_id;
END;
$$;

ALTER FUNCTION public.create_agency_account_with_owner_invite(
  TEXT, TEXT, UUID, TEXT, TEXT, TIMESTAMPTZ
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_agency_account_with_owner_invite(
  TEXT, TEXT, UUID, TEXT, TEXT, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_agency_account_with_owner_invite(
  TEXT, TEXT, UUID, TEXT, TEXT, TIMESTAMPTZ
) TO service_role;
