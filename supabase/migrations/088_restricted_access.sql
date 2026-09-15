-- ============================================================
-- 088_restricted_access.sql — close open self-serve signup while
-- pricing/billing infrastructure doesn't exist yet: only the agency
-- owner can grant a brand-new account full access, either by
-- creating it directly (the existing agency owner-invite flow,
-- migration 052 — unchanged) or by activating an account that
-- signed itself up organically through the still-open /signup form.
--
-- Mechanism: a new accounts.status column.
--   - DEFAULT 'active' — every existing row (all 5 real production
--     accounts, and the row create_agency_account_with_owner_invite
--     inserts, migration 052, which never sets this column) keeps
--     working exactly as today with zero migration of existing data.
--   - handle_new_user() (017_account_sharing.sql) is the ONE place
--     that sees every self-serve signup, email/password or Google
--     OAuth alike — the app-level /signup page can be bypassed by
--     calling Supabase's Auth API directly, but nothing bypasses this
--     trigger. It now explicitly inserts new personal accounts as
--     'pending' instead of relying on the column default, so a
--     from-scratch signup is gated while every other account-creation
--     path (agency invite, and any future one) is unaffected unless it
--     also explicitly asks for 'pending'.
--
-- The app enforces the gate itself (dashboard-shell.tsx redirects a
-- non-'active' account to /acceso-restringido instead of the
-- dashboard/onboarding) — this migration only establishes the data
-- model and the one trigger change needed to make 'pending' the
-- default outcome of an ungated signup.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('pending', 'active', 'suspended'));

CREATE INDEX IF NOT EXISTS idx_accounts_status
  ON accounts(status)
  WHERE status <> 'active';

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_full_name TEXT;
  v_account_id UUID;
BEGIN
  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', '');

  INSERT INTO public.accounts (name, owner_user_id, status)
  VALUES (COALESCE(NULLIF(v_full_name, ''), NEW.email, 'My account'), NEW.id, 'pending')
  RETURNING id INTO v_account_id;

  INSERT INTO public.profiles (user_id, full_name, email, account_id, account_role)
  VALUES (NEW.id, v_full_name, NEW.email, v_account_id, 'owner');

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to bootstrap account/profile for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.handle_new_user() OWNER TO postgres;

-- Surface the new column on the agency panel's cross-account overview.
-- This view has moved past 051_agency_overview.sql's original shape —
-- 066 added whatsapp_connection_method, 067 added owner_user_id,
-- member_count, and never_used — so this re-declares the view's
-- CURRENT live definition (066/067's, confirmed against production via
-- pg_get_viewdef before writing this) with account_status appended.
--
-- Postgres only allows CREATE OR REPLACE VIEW to append new columns at
-- the end of the SELECT list — inserting one earlier, or basing this
-- on a stale/older shape of the view, reads as dropping/renaming the
-- columns after it (error 42P16, see 066/067's own headers for the
-- same issue). account_status goes last for exactly that reason, even
-- though it reads more naturally grouped with the other account_*
-- columns above.
CREATE OR REPLACE VIEW agency_account_overview AS
SELECT
  a.id AS account_id,
  a.name AS account_name,
  a.created_at AS account_created_at,
  a.default_currency,
  a.owner_user_id,
  (
    SELECT COUNT(*) FROM profiles p WHERE p.account_id = a.id
  ) AS member_count,
  (
    CASE
      WHEN wc.status = 'connected' THEN 'connected'
      WHEN zac.whatsapp_account_id IS NOT NULL THEN 'connected'
      ELSE 'disconnected'
    END
  ) AS whatsapp_status,
  (
    CASE
      WHEN wc.status = 'connected' AND wc.send_api_base IS NOT NULL THEN 'coexistence'
      WHEN wc.status = 'connected' THEN 'meta'
      WHEN zac.whatsapp_account_id IS NOT NULL THEN 'zernio'
      ELSE NULL
    END
  ) AS whatsapp_connection_method,
  (
    SELECT COUNT(*) FROM conversations c
    WHERE c.account_id = a.id AND c.status = 'open'
  ) AS active_conversations,
  (
    SELECT COUNT(*) FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE c.account_id = a.id AND m.created_at >= date_trunc('day', now())
  ) AS messages_today,
  (
    SELECT COUNT(*) FROM contacts ct
    WHERE ct.account_id = a.id AND ct.created_at >= date_trunc('day', now())
  ) AS new_leads_today,
  (
    SELECT COUNT(*) FROM contacts ct
    WHERE ct.account_id = a.id AND ct.created_at >= now() - interval '7 days'
  ) AS new_leads_week,
  (
    SELECT COUNT(*) FROM contacts ct
    WHERE ct.account_id = a.id AND ct.lead_score = 'hot'
  ) AS hot_leads,
  (
    SELECT COALESCE(SUM(d.value), 0) FROM deals d
    WHERE d.account_id = a.id AND d.status = 'open'
  ) AS open_pipeline_value,
  (
    SELECT MAX(m.created_at) FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE c.account_id = a.id
  ) AS last_activity_at,
  (
    wc.status IS DISTINCT FROM 'connected'
    AND zac.whatsapp_account_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM contacts ct WHERE ct.account_id = a.id)
    AND NOT EXISTS (SELECT 1 FROM conversations c WHERE c.account_id = a.id)
  ) AS never_used,
  a.status AS account_status
FROM accounts a
LEFT JOIN whatsapp_config wc ON wc.account_id = a.id
LEFT JOIN client_zernio_accounts zac ON zac.account_id = a.id;

REVOKE ALL ON agency_account_overview FROM PUBLIC, anon, authenticated;
GRANT SELECT ON agency_account_overview TO service_role;
