-- ============================================================
-- 097_agency_billing.sql — subscription/billing tracking for the
-- agency owner's super-admin panel (/agency).
--
-- 088_restricted_access.sql's header noted self-serve signup was
-- closed "while pricing/billing infrastructure doesn't exist yet" —
-- this is that infrastructure. No payment processor is wired up
-- anywhere in this codebase (confirmed: no Stripe/PayPal references),
-- so this is deliberately a MANUAL record — the agency owner sets the
-- plan/price/status themselves after billing a client outside the
-- app (bank transfer, invoice, whatever) — not a live subscription
-- engine. One row per account, created on first edit from the panel
-- (no row = "never configured", not "free"), account-scoped 1:1 via
-- a PK on account_id rather than a surrogate id.
--
-- RLS enabled with NO policies, same posture as every other
-- agency-only table/view (e.g. agency_account_overview's REVOKE ALL):
-- the panel only ever reads/writes this through the service-role
-- client (src/lib/agency/admin-client.ts), which bypasses RLS
-- entirely, so an empty policy set just means "nothing reachable
-- through the normal anon/authenticated REST API" — belt-and-
-- suspenders, not the actual access boundary.
--
-- Idempotente — segura de re-ejecutar.
-- ============================================================

CREATE TABLE IF NOT EXISTS account_billing (
  account_id UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  plan_name TEXT,
  price_amount NUMERIC(12, 2),
  billing_cycle TEXT NOT NULL DEFAULT 'monthly'
    CHECK (billing_cycle IN ('monthly', 'yearly')),
  subscription_status TEXT NOT NULL DEFAULT 'active'
    CHECK (subscription_status IN ('trial', 'active', 'past_due', 'canceled')),
  renewal_date DATE,
  notes TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE account_billing ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON account_billing FROM PUBLIC, anon, authenticated;
GRANT ALL ON account_billing TO service_role;

-- Re-declares agency_account_overview's CURRENT live shape (088's) with
-- billing columns appended — CREATE OR REPLACE VIEW only allows adding
-- columns at the end of the SELECT list, so this must restate every
-- prior column rather than just the new ones (same constraint 066/067/088
-- ran into, see their headers).
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
  a.status AS account_status,
  ab.plan_name,
  ab.price_amount,
  ab.billing_cycle,
  ab.subscription_status,
  ab.renewal_date
FROM accounts a
LEFT JOIN whatsapp_config wc ON wc.account_id = a.id
LEFT JOIN client_zernio_accounts zac ON zac.account_id = a.id
LEFT JOIN account_billing ab ON ab.account_id = a.id;

REVOKE ALL ON agency_account_overview FROM PUBLIC, anon, authenticated;
GRANT SELECT ON agency_account_overview TO service_role;
