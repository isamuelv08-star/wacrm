-- ============================================================
-- 117 — Indexes for scale (thousands of contacts / many accounts)
-- ============================================================
--
-- Every index here backs a query the app runs on a hot path today and
-- that, without it, is a sequential scan whose cost grows with the
-- table: fine at a few thousand rows, a problem at hundreds of
-- thousands. Grouped by the screen / job that needs it.
--
-- Plain CREATE INDEX (the SQL editor runs in a transaction, which
-- CONCURRENTLY can't): each briefly blocks writes to its table while
-- it builds — seconds at today's sizes. Run it at a quiet moment.
-- Idempotent.
-- ============================================================

-- ── Inbox ────────────────────────────────────────────────────
-- Conversation list: the account's threads, most recent first (paged).
CREATE INDEX IF NOT EXISTS idx_conversations_account_last_message
  ON conversations (account_id, last_message_at DESC NULLS LAST);

-- Unread badge (use-total-unread): only threads with unread messages.
CREATE INDEX IF NOT EXISTS idx_conversations_account_unread
  ON conversations (account_id) WHERE unread_count > 0;

-- ── Contacts ─────────────────────────────────────────────────
-- Contacts page: newest first, paged.
CREATE INDEX IF NOT EXISTS idx_contacts_account_created
  ON contacts (account_id, created_at DESC);

-- Search boxes (contacts page, contact picker, inbox): `ILIKE '%term%'`
-- can only use a trigram index.
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
CREATE INDEX IF NOT EXISTS idx_contacts_name_trgm
  ON contacts USING gin (name extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_contacts_phone_trgm
  ON contacts USING gin (phone extensions.gin_trgm_ops);

-- Broadcast audiences by custom field.
CREATE INDEX IF NOT EXISTS idx_contact_custom_values_field
  ON contact_custom_values (custom_field_id);

CREATE INDEX IF NOT EXISTS idx_contact_notes_contact
  ON contact_notes (contact_id);

-- ── Deals / pipeline ─────────────────────────────────────────
-- "This contact's open deal" — looked up on EVERY inbound message
-- (webhooks, AI turn analysis, auto-reply). deals.contact_id had no
-- index at all.
CREATE INDEX IF NOT EXISTS idx_deals_contact_status
  ON deals (contact_id, status);

-- Pipeline board: a pipeline's open deals + recently closed ones.
CREATE INDEX IF NOT EXISTS idx_deals_pipeline_status_created
  ON deals (pipeline_id, status, created_at DESC);

-- Dashboards (open / won / lost per account, new deals per period).
CREATE INDEX IF NOT EXISTS idx_deals_account_status
  ON deals (account_id, status);
CREATE INDEX IF NOT EXISTS idx_deals_account_created
  ON deals (account_id, created_at);

CREATE INDEX IF NOT EXISTS idx_deals_conversation
  ON deals (conversation_id) WHERE conversation_id IS NOT NULL;

-- CEO dashboard: stage movements in a date window.
CREATE INDEX IF NOT EXISTS idx_deal_stage_history_account_changed
  ON deal_stage_history (account_id, changed_at);

-- ── Background jobs (crons) ──────────────────────────────────
-- Lead-staleness and hot-lead alerts: threads waiting on us, recent.
CREATE INDEX IF NOT EXISTS idx_conversations_waiting_on_us
  ON conversations (last_message_at)
  WHERE last_message_sender_type = 'customer';

-- AI auto-resume: paused threads per account.
CREATE INDEX IF NOT EXISTS idx_conversations_ai_paused
  ON conversations (account_id, ai_paused_at)
  WHERE ai_autoreply_disabled = TRUE;

-- Sales-intelligence scan: each account at most hourly, least recently
-- scanned first (src/lib/sales-intelligence/risk-engine.ts) instead of
-- every account on every 5-minute tick.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS risk_scanned_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_accounts_risk_scanned
  ON accounts (risk_scanned_at NULLS FIRST) WHERE status = 'active';

-- Refresh planner statistics so the new indexes are used right away.
ANALYZE conversations;
ANALYZE contacts;
ANALYZE deals;
ANALYZE deal_stage_history;
