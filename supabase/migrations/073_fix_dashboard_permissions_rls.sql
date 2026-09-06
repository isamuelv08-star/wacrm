-- ============================================================
-- 073_fix_dashboard_permissions_rls.sql — lock down
--                                          profiles.dashboard_permissions
--
-- The problem
--
--   034_fix_profiles_update_rls.sql added a BEFORE UPDATE trigger
--   (enforce_profile_privilege_columns) that rejects a plain
--   `authenticated` client changing `account_role` or `account_id` on
--   its own `profiles` row — those columns back `is_account_member()`,
--   so letting a self-service PATCH touch them was a full privilege
--   escalation.
--
--   054_dashboard_permissions.sql later added a THIRD privilege
--   column, `dashboard_permissions` (which sales-facing widgets —
--   revenue KPIs, sales-vs-goal, the funnel, commercial metrics, top
--   sellers, alerts — a member sees on /dashboard), meant to be
--   writable only via the admin-only `set_member_dashboard_permissions`
--   RPC. But the 034 trigger was never extended to cover it, and
--   `profiles_update`'s RLS policy only constrains WHICH ROW a client
--   may update (`auth.uid() = user_id`), not which column — same class
--   of gap 034 fixed, just on a column added after that migration
--   shipped. Any signed-in viewer/agent could self-grant visibility
--   into every gated widget with:
--
--     PATCH /rest/v1/profiles?user_id=eq.<self>
--     { "dashboard_permissions": {"salesKpis": true, "salesVsGoal": true,
--       "commercialMetrics": true, "topSellers": true, "leadsByRep": true,
--       "alerts": true} }
--
--   Not a cross-tenant leak (still scoped to their own account's data),
--   but it defeats the entire point of per-widget dashboard
--   permissions, and undermines anything else that trusts
--   `dashboard_permissions` as the ground truth for what a member is
--   allowed to see (e.g. the sidebar AI assistant's data snapshot).
--
-- The fix
--
--   Extend enforce_profile_privilege_columns() to also reject a
--   client-side change to `dashboard_permissions`, using the exact
--   same `current_user = 'authenticated'` discriminator as the
--   existing two columns. Legitimate writers are unaffected for the
--   same reason they already were for account_role/account_id:
--     - redeem_invitation (054) is SECURITY DEFINER owned by postgres.
--     - set_member_dashboard_permissions (054) is SECURITY DEFINER
--       owned by postgres.
--     - the server backend runs as service_role.
--   Self-service edits that leave all three columns untouched keep
--   working exactly as before.
--
-- Idempotent — CREATE OR REPLACE + DROP TRIGGER IF EXISTS, safe to
-- re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION public.enforce_profile_privilege_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF (NEW.account_role IS DISTINCT FROM OLD.account_role
      OR NEW.account_id IS DISTINCT FROM OLD.account_id
      OR NEW.dashboard_permissions IS DISTINCT FROM OLD.dashboard_permissions)
     AND current_user = 'authenticated'
  THEN
    RAISE EXCEPTION
      'account_role, account_id, and dashboard_permissions cannot be changed directly; use the account member/invitation RPCs'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.enforce_profile_privilege_columns() OWNER TO postgres;

DROP TRIGGER IF EXISTS enforce_profile_privilege_columns ON public.profiles;
CREATE TRIGGER enforce_profile_privilege_columns
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_profile_privilege_columns();

-- ============================================================
-- Manual validation (run against a live instance — no automated
-- SQL test harness exists in this repo):
--
--   1. As a viewer/agent JWT via PostgREST, this must return 42501
--      (insufficient_privilege):
--        PATCH /rest/v1/profiles?user_id=eq.<self>
--        { "dashboard_permissions": {"salesKpis": true} }
--   2. The two checks from 034 (account_role, account_id) must still
--      return 42501 the same way.
--   3. A self-service edit that leaves all three columns alone must
--      still succeed:
--        PATCH /rest/v1/profiles?user_id=eq.<self> { "full_name": "New Name" }
--   4. set_member_dashboard_permissions (admin+ caller) must still
--      succeed — it runs SECURITY DEFINER as postgres.
-- ============================================================
