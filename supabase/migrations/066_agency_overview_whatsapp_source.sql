-- ============================================================
-- 066_agency_overview_whatsapp_source.sql — agency panel: recognize
-- Zernio-connected accounts as "WhatsApp connected".
--
-- agency_account_overview (migration 051) only LEFT JOINed
-- whatsapp_config and read wc.status, so every account connected via
-- Zernio (client_zernio_accounts, migration 048 — its own table,
-- deliberately not whatsapp_config, since Zernio holds the Meta
-- credentials itself and exposes its own inbox API rather than
-- Cloud-API-shaped access; see migration 056's header) had no
-- whatsapp_config row at all and showed up as disconnected in the
-- panel regardless of its real state. Every account looked like it
-- needed attention.
--
-- Also adds whatsapp_connection_method so the panel can say *how* an
-- account is connected instead of a bare yes/no — 'meta' (direct
-- Cloud API), 'coexistence' (Dualhook-style provider,
-- whatsapp_config.send_api_base set), or 'zernio'. Precedence when
-- (in theory) more than one path has a row: whatsapp_config wins over
-- Zernio, since it's the older/primary path and a real send_api_base
-- or direct-Meta connection is more specific than Zernio's presence.
--
-- Uses DROP + CREATE rather than CREATE OR REPLACE VIEW: the new
-- whatsapp_connection_method column sits between whatsapp_status and
-- active_conversations, and Postgres's CREATE OR REPLACE VIEW only
-- allows appending columns at the very end — inserting one in the
-- middle shifts every later column's position, which Postgres reports
-- as "cannot change name of view column ... to ..." (42P16) since it
-- reads as renaming whichever column now occupies that slot. Nothing
-- else in the schema references this view (it's service-role-only,
-- per 051's header), so dropping and recreating it is safe.
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
  ) AS last_activity_at
FROM accounts a
LEFT JOIN whatsapp_config wc ON wc.account_id = a.id
LEFT JOIN client_zernio_accounts zac ON zac.account_id = a.id;

REVOKE ALL ON agency_account_overview FROM PUBLIC, anon, authenticated;
GRANT SELECT ON agency_account_overview TO service_role;
