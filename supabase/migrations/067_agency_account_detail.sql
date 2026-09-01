-- ============================================================
-- 067_agency_account_detail.sql — data the agency panel's new
-- per-account detail view needs: member count (to flag empty/ghost
-- accounts — e.g. a personal account remove_account_member spun up
-- for someone who never rejoined anywhere, or a direct signup nobody
-- ever invited into a real account) and owner_user_id (so the detail
-- view can block deleting the owner as an individual member — that's
-- only possible by deleting the whole account, see accounts.owner_user_id's
-- ON DELETE RESTRICT in migration 017).
--
-- Uses DROP + CREATE rather than CREATE OR REPLACE VIEW — same reason
-- as migration 066's header: owner_user_id and member_count sit before
-- existing columns, and Postgres only allows CREATE OR REPLACE VIEW to
-- append columns at the end. (If you hit "cannot change name of view
-- column ... to ..." running an earlier version of 066 against this
-- view, that's the same issue — 066 has since been fixed the same way.)
--
-- Idempotent — safe to re-run.
-- ============================================================

DROP VIEW IF EXISTS agency_account_overview;

CREATE VIEW agency_account_overview AS
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
  -- True when the account has never done anything at all — no
  -- contacts, no conversations, never connected WhatsApp. Distinct
  -- from "stale" (had activity once, gone quiet): this is "was this
  -- ever actually used", the signal for "probably an orphaned/test
  -- account safe to delete", not "this client needs a check-in".
  (
    wc.status IS DISTINCT FROM 'connected'
    AND zac.whatsapp_account_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM contacts ct WHERE ct.account_id = a.id)
    AND NOT EXISTS (SELECT 1 FROM conversations c WHERE c.account_id = a.id)
  ) AS never_used
FROM accounts a
LEFT JOIN whatsapp_config wc ON wc.account_id = a.id
LEFT JOIN client_zernio_accounts zac ON zac.account_id = a.id;

REVOKE ALL ON agency_account_overview FROM PUBLIC, anon, authenticated;
GRANT SELECT ON agency_account_overview TO service_role;
