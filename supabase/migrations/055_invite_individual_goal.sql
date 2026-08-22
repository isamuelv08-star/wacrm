-- ============================================================
-- 055_invite_individual_goal.sql — set a new member's individual
-- sales goal right in the "Add member" form, instead of a separate
-- trip to Settings -> Sales goals afterward.
--
-- account_invitations.individual_sales_goal carries the chosen
-- monthly target on the invite itself (there's no profile — and so
-- no sales_goals row to attach it to — until the invite is redeemed).
-- redeem_invitation() gains one more step: once the new profile
-- exists, if the invite carried a goal, it inserts the matching
-- sales_goals row for the CURRENT month (the month the member
-- actually joins, not whenever the invite happened to be created —
-- an invite can sit unredeemed for a while, and "this month's target"
-- should mean the month they actually start).
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE account_invitations
  ADD COLUMN IF NOT EXISTS individual_sales_goal NUMERIC(12,2)
    CHECK (individual_sales_goal IS NULL OR individual_sales_goal >= 0);

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
  WHERE user_id = v_caller_id;

  IF v_inv.role = 'owner' THEN
    UPDATE accounts
    SET owner_user_id = v_caller_id
    WHERE id = v_inv.account_id;
  END IF;

  -- New: the invite's individual monthly goal (if any) lands as a
  -- sales_goals row for the month the member actually joins in.
  -- ON CONFLICT is defensive belt-and-braces — accepted_at is set
  -- just below in the SAME transaction as this insert, and the
  -- "already redeemed" check above means a real double-run can't
  -- happen, but a retried redeem_invitation call (e.g. a client
  -- double-submit that raced past the accepted_at check somehow)
  -- should update rather than error.
  IF v_inv.individual_sales_goal IS NOT NULL THEN
    SELECT default_currency INTO v_currency
    FROM accounts WHERE id = v_inv.account_id;

    INSERT INTO sales_goals (account_id, user_id, period_month, target_value, currency)
    VALUES (
      v_inv.account_id,
      v_caller_id,
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
