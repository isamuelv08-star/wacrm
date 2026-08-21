-- ============================================================
-- 051_agency_overview.sql — cross-account overview for the agency
-- owner's super-admin panel (/agency).
--
-- This is a DELIBERATE exception to the per-account RLS isolation
-- every other table enforces (is_account_member(), migration 017).
-- It does NOT weaken that isolation — RLS on every underlying table
-- stays exactly as-is. The view is only ever queried through the
-- service-role client (src/lib/agency/admin-client.ts), which
-- bypasses RLS at the Supabase/Postgres level regardless of what the
-- view itself grants; the REVOKE/GRANT below is belt-and-suspenders
-- so the view is unreachable through the normal anon/authenticated
-- REST API too, even though nothing in the app is expected to expose
-- it that way. Same defensive posture as migration 007's
-- increment_automation_execution_count.
--
-- messages has no account_id of its own (only via
-- conversation_id -> conversations.account_id, see
-- 001_initial_schema.sql / 017_account_sharing.sql:180), hence the
-- join in the message-based subqueries below.
--
-- Idempotent — safe to re-run.
-- ============================================================

CREATE OR REPLACE VIEW agency_account_overview AS
SELECT
  a.id AS account_id,
  a.name AS account_name,
  a.created_at AS account_created_at,
  a.default_currency,
  wc.status AS whatsapp_status, -- 'connected' | 'disconnected' | NULL (never configured)
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
  ) AS last_activity_at
FROM accounts a
LEFT JOIN whatsapp_config wc ON wc.account_id = a.id;

REVOKE ALL ON agency_account_overview FROM PUBLIC, anon, authenticated;
GRANT SELECT ON agency_account_overview TO service_role;
