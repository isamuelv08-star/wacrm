-- ============================================================
-- 058_fix_redeem_invitation_goal_fk.sql — fix a wrong-id bug in
-- redeem_invitation() (migration 055).
--
-- sales_goals.user_id is a FK to profiles.id, NOT auth.users.id (see
-- migration 053's column definition and 043's own comment about this
-- exact distinction for deals.assigned_to). redeem_invitation()'s
-- individual-goal insert used `v_caller_id` (= auth.uid(), the AUTH
-- id) directly as sales_goals.user_id — a value that essentially
-- never matches a real profiles.id, so that INSERT would raise a
-- foreign-key violation and abort the ENTIRE function, meaning a
-- redeemed invitation carrying an individual sales goal would fail
-- outright and the invited member could never join. Same class of
-- id/profile_id confusion just found and fixed client-side in
-- src/lib/dashboard/ceo-queries.ts (loadTopSellers) and
-- src/components/settings/goals-settings.tsx.
--
-- Fix: resolve the caller's own profiles.id (the row was already
-- created at signup and just got UPDATEd earlier in this same
-- function) and use THAT for the sales_goals insert.
--
-- Idempotent — safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION public.redeem_invitation(
  p_token_hash TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_caller_profile_id UUID;
  v_inv account_invitations%ROWTYPE;
  v_old_account_id UUID;
  v_old_account_owner UUID;
  v_has_data BOOLEAN;
  v_currency TEXT;
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
      account_role = v_inv.role,
      dashboard_permissions = v_inv.dashboard_permissions
  WHERE user_id = v_caller_id
  RETURNING id INTO v_caller_profile_id;

  IF v_inv.role = 'owner' THEN
    UPDATE accounts
    SET owner_user_id = v_caller_id
    WHERE id = v_inv.account_id;
  END IF;

  -- The invite's individual monthly goal (if any) lands as a
  -- sales_goals row for the month the member actually joins in.
  -- sales_goals.user_id references profiles.id, not auth.users.id —
  -- v_caller_profile_id (resolved above), not v_caller_id, is what
  -- has to go here (see this migration's header note).
  IF v_inv.individual_sales_goal IS NOT NULL THEN
    SELECT default_currency INTO v_currency
    FROM accounts WHERE id = v_inv.account_id;

    INSERT INTO sales_goals (account_id, user_id, period_month, target_value, currency)
    VALUES (
      v_inv.account_id,
      v_caller_profile_id,
      date_trunc('month', NOW())::date,
      v_inv.individual_sales_goal,
      COALESCE(v_currency, 'USD')
    )
    ON CONFLICT (account_id, user_id, period_month) WHERE user_id IS NOT NULL
    DO UPDATE SET target_value = EXCLUDED.target_value;
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
