-- ============================================================
-- 087_multiwhatsapp_number_scoped_rls.sql — Phase 6 of multiple
-- WhatsApp numbers per account: each seller sees only their own
-- number's conversations/messages once an account is in
-- 'multiwhatsapp' mode (085) — "el dueño ve todo consolidado, cada
-- vendedor ve lo suyo."
--
-- Mechanism: a RESTRICTIVE policy per table, added ALONGSIDE the
-- existing PERMISSIVE `*_select` policy from migration 017 — not a
-- replacement. Postgres composes them as
-- "(any permissive policy passes) AND (every restrictive policy
-- passes)", so this can only ever narrow what 017's policy already
-- allows, never grant anything new. That composition is exactly why
-- this is safe to add without touching a single existing policy:
--
--   can_view_conversation_number(...) returns TRUE (no restriction)
--   whenever ANY of these hold:
--     - the caller is admin+ on the account (owner/admin always see
--       everything, consolidated — matches "el dueño ve todo");
--     - the account is NOT in 'multiwhatsapp' mode — covers every
--       account that existed before this phase, and 'shared' still
--       being the default for new ones. This is what makes the
--       change a no-op for the account actually running in
--       production today;
--     - the conversation has no specific number
--       (whatsapp_config_id IS NULL) — untagged/shared conversations
--       (everything from before 084's tagging, or the Zernio path,
--       which doesn't tag numbers yet) stay visible to the whole
--       team, same as always;
--     - the caller is the owner_user_id of that specific
--       whatsapp_config row.
--   It's FALSE (hidden) only for a non-admin member of a
--   multiwhatsapp account, looking at a conversation tagged to a
--   number owned by someone ELSE.
--
-- Applied to both `conversations` and `messages` directly (not
-- relying solely on messages_select's existing subquery into
-- conversations inheriting the new restriction, even though it
-- should) — belt-and-suspenders for customer message content
-- specifically, cheap to add.
--
-- Scope: contacts, deals, and dashboard metrics are NOT restricted by
-- this migration — contacts are deliberately account-wide/shared
-- (086's header), and per-seller metrics filtering is a query-level
-- (not access-control-level) concern for the dashboard, phase 7.
-- Only the inbox's actual message content is access-restricted here.
--
-- Idempotent — safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION public.can_view_conversation_number(
  p_account_id UUID,
  p_whatsapp_config_id UUID
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    is_account_member(p_account_id, 'admin')
    OR NOT EXISTS (
      SELECT 1 FROM accounts a
      WHERE a.id = p_account_id AND a.whatsapp_mode = 'multiwhatsapp'
    )
    OR p_whatsapp_config_id IS NULL
    OR EXISTS (
      SELECT 1 FROM whatsapp_config wc
      WHERE wc.id = p_whatsapp_config_id AND wc.owner_user_id = auth.uid()
    );
$$;

ALTER FUNCTION public.can_view_conversation_number(UUID, UUID) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.can_view_conversation_number(UUID, UUID) TO authenticated, service_role;

DROP POLICY IF EXISTS conversations_select_number_scope ON conversations;
CREATE POLICY conversations_select_number_scope ON conversations
  AS RESTRICTIVE
  FOR SELECT
  USING (can_view_conversation_number(account_id, whatsapp_config_id));

DROP POLICY IF EXISTS messages_select_number_scope ON messages;
CREATE POLICY messages_select_number_scope ON messages
  AS RESTRICTIVE
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = messages.conversation_id
        AND can_view_conversation_number(c.account_id, c.whatsapp_config_id)
    )
  );
