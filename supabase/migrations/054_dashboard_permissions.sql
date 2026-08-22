-- ============================================================
-- 054_dashboard_permissions.sql — per-widget dashboard visibility
--
-- The sales-facing widgets (revenue KPIs, sales-vs-goal, the funnel,
-- commercial metrics, the top-sellers leaderboard, alerts) moved onto
-- the SAME /dashboard page everyone already uses instead of a
-- separate owner-only page — but not everyone should see all of it.
-- `profiles.dashboard_permissions` stores per-member overrides (a
-- sparse JSONB object — most members have `{}`); a widget key absent
-- from it falls back to a role default computed in application code
-- (see `canViewDashboardSection` in src/lib/auth/roles.ts: admin+
-- defaults open, agent/viewer defaults closed). Storing only the
-- overrides (not a resolved snapshot) means promoting/demoting a
-- member automatically changes what's visible for anything nobody
-- ever explicitly toggled, with no backfill needed here or later if
-- the default itself changes.
--
-- Three pieces:
--   1. profiles.dashboard_permissions — the live per-member overrides.
--   2. account_invitations.dashboard_permissions — carried on the
--      invite so overrides chosen at invite time land on the new
--      profile the moment it's redeemed (mirrors how `role` already
--      flows invitation -> profile in redeem_invitation).
--   3. set_member_dashboard_permissions(p_user_id, p_permissions) —
--      the only way to change #1 for an EXISTING member, admin+ only,
--      same shape as set_member_round_robin_opt_in (042).
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS dashboard_permissions JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE account_invitations
  ADD COLUMN IF NOT EXISTS dashboard_permissions JSONB NOT NULL DEFAULT '{}'::jsonb;

-- ------------------------------------------------------------
-- redeem_invitation — byte-for-byte the same as 052's version, plus
-- one line carrying dashboard_permissions from the invite onto the
-- freshly-joined profile.
-- ------------------------------------------------------------
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
      account_role = v_inv.role,
      dashboard_permissions = v_inv.dashboard_permissions
  WHERE user_id = v_caller_id;

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
-- set_member_dashboard_permissions(p_user_id, p_permissions)
--
-- Admin+ overwrites a teammate's (or their own) dashboard-widget
-- overrides wholesale — the caller sends the full resolved object
-- (e.g. `{"salesKpis": true, "topSellers": false}`), not a partial
-- patch, mirroring how the Members-tab UI already collects all six
-- checkboxes before saving. No self-target restriction, same
-- reasoning as set_member_round_robin_opt_in: toggling your own
-- dashboard visibility carries no privilege-lockout risk.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_member_dashboard_permissions(
  p_user_id UUID,
  p_permissions JSONB
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

  IF jsonb_typeof(p_permissions) <> 'object' THEN
    RAISE EXCEPTION 'p_permissions must be a JSON object' USING ERRCODE = '22023';
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

  UPDATE profiles SET dashboard_permissions = p_permissions
  WHERE user_id = p_user_id;
END;
$$;

ALTER FUNCTION public.set_member_dashboard_permissions(UUID, JSONB) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_member_dashboard_permissions(UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_member_dashboard_permissions(UUID, JSONB) TO authenticated;
