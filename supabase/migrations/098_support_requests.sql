-- ============================================================
-- 098_support_requests.sql — "Contact support" from the client
-- sidebar, integrated with the agency owner's super-admin panel.
--
-- Any account member can open one (any role, viewer included — same
-- posture as team_chat_messages, 090). Deliberately no UPDATE/DELETE
-- policy for regular members: resolving a request is an agency-owner
-- action only, done through /agency's service-role client
-- (src/lib/agency/admin-client.ts), which bypasses RLS entirely —
-- omitting the policy is enough to block it for `authenticated`, no
-- REVOKE needed (RLS is default-deny per command when no policy for
-- that command exists).
--
-- Idempotente — segura de re-ejecutar.
-- ============================================================

CREATE TABLE IF NOT EXISTS support_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_support_requests_account_created
  ON support_requests(account_id, created_at DESC);

-- Backs the agency panel's "open requests across every account" list
-- and its stat-bar count — a partial index since that query only ever
-- cares about the open ones.
CREATE INDEX IF NOT EXISTS idx_support_requests_open
  ON support_requests(created_at DESC)
  WHERE status = 'open';

ALTER TABLE support_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS support_requests_select ON support_requests;
CREATE POLICY support_requests_select ON support_requests FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS support_requests_insert ON support_requests;
CREATE POLICY support_requests_insert ON support_requests FOR INSERT
  WITH CHECK (is_account_member(account_id) AND created_by_user_id = auth.uid());
