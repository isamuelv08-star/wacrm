-- ============================================================
-- 121 — The AI can quote from the catalog and send the quote PDF
-- ============================================================
--
-- ai_configs.ai_quotes_enabled (Settings → AI, off by default): while
-- replying, the AI sees the catalog products that match what the
-- customer is asking about (with their real prices) and, once the
-- customer has chosen product(s) and quantity, can send a formal quote
-- — same PDF, numbering and tax as a quote an advisor makes
-- (src/lib/ai/quote-actions.ts). Catalog products at catalog prices
-- only; at most 3 AI quotes per conversation per day.
--
-- quotes.created_by_ai marks those, so the team can see which quotes
-- the AI sent. Idempotent.
-- ============================================================

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS ai_quotes_enabled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS created_by_ai BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_quotes_conversation_ai
  ON quotes (conversation_id, created_at DESC) WHERE created_by_ai;
