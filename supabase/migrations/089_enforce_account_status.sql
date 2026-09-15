-- ============================================================
-- 089_enforce_account_status.sql — security-audit follow-up to
-- 088_restricted_access.sql: a 'pending' (self-signed-up, not yet
-- approved) or 'suspended' account's own valid session was still
-- able to read/write its core data directly against Supabase's
-- PostgREST REST API, bypassing this app's Next.js layer entirely
-- (DashboardShell's redirect to /acceso-restringido is a client-side
-- UX nicety, not access control — nothing stopped a direct API call
-- with the same session cookie). The app-layer fix
-- (getCurrentAccount(), src/lib/auth/account.ts) now closes that for
-- the ~85 routes that go through it; this migration is the matching
-- database-layer backstop for anyone who skips the app and talks to
-- Supabase directly.
--
-- Deliberately does NOT touch is_account_member() itself (used by
-- accounts_select/accounts_update/profiles' own policies, migration
-- 017) — a pending/suspended user still needs to see their OWN
-- account row and profile so /acceso-restringido can tell them why
-- they're blocked. Blocking that too would hide the very message
-- explaining the block.
--
-- Instead, RESTRICTIVE policies — additive, ANDed against the
-- existing PERMISSIVE ones, same mechanism as 087's number-scoped
-- inbox RLS — are added to the four tables that hold the actual
-- product data: contacts, conversations, messages, deals. This can
-- only ever narrow what the existing policies already allow, never
-- grant anything new, so it's safe to add without touching a single
-- existing policy. `FOR ALL` (not just SELECT) so a restricted
-- account can't write either.
--
-- Idempotent — safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION public.account_is_active(p_account_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT status = 'active' FROM accounts WHERE id = p_account_id;
$$;

ALTER FUNCTION public.account_is_active(UUID) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.account_is_active(UUID) TO authenticated, service_role;

DROP POLICY IF EXISTS contacts_account_active ON contacts;
CREATE POLICY contacts_account_active ON contacts
  AS RESTRICTIVE
  FOR ALL
  USING (account_is_active(account_id))
  WITH CHECK (account_is_active(account_id));

DROP POLICY IF EXISTS conversations_account_active ON conversations;
CREATE POLICY conversations_account_active ON conversations
  AS RESTRICTIVE
  FOR ALL
  USING (account_is_active(account_id))
  WITH CHECK (account_is_active(account_id));

DROP POLICY IF EXISTS deals_account_active ON deals;
CREATE POLICY deals_account_active ON deals
  AS RESTRICTIVE
  FOR ALL
  USING (account_is_active(account_id))
  WITH CHECK (account_is_active(account_id));

-- messages has no account_id of its own — same join-through-
-- conversation shape as 087's messages_select_number_scope.
DROP POLICY IF EXISTS messages_account_active ON messages;
CREATE POLICY messages_account_active ON messages
  AS RESTRICTIVE
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = messages.conversation_id
        AND account_is_active(c.account_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = messages.conversation_id
        AND account_is_active(c.account_id)
    )
  );
