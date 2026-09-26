-- ============================================================
-- 120 — Product catalog and quotes (proformas) sent from the chat
-- ============================================================
--
--   products         the account's catalog (name, SKU, price)
--   quotes           a proforma for a contact (optionally tied to a
--                    deal / conversation), numbered per account
--                    (<prefix>-000123), with its totals frozen when saved
--   quote_items      its lines — copied from the catalog, then editable
--   quote settings   on accounts: tax label and %, validity, terms,
--                    numbering prefix + next number
--
-- Sending a quote renders a PDF, uploads it next to the chat's other
-- attachments and sends it on WhatsApp (src/lib/quotes). Idempotent.
-- ============================================================

-- ── Settings (per account) ───────────────────────────────────
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS quote_tax_label TEXT NOT NULL DEFAULT 'IVA',
  ADD COLUMN IF NOT EXISTS quote_tax_rate NUMERIC(5, 2) NOT NULL DEFAULT 0
    CHECK (quote_tax_rate >= 0 AND quote_tax_rate <= 100),
  ADD COLUMN IF NOT EXISTS quote_prices_include_tax BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS quote_validity_days INTEGER NOT NULL DEFAULT 15
    CHECK (quote_validity_days BETWEEN 1 AND 365),
  ADD COLUMN IF NOT EXISTS quote_terms TEXT,
  ADD COLUMN IF NOT EXISTS quote_prefix TEXT NOT NULL DEFAULT 'COT',
  ADD COLUMN IF NOT EXISTS quote_next_number INTEGER NOT NULL DEFAULT 1;

-- ── Catalog ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name        TEXT NOT NULL CHECK (length(trim(name)) > 0),
  sku         TEXT,
  description TEXT,
  unit_price  NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_products_account_name ON products (account_id, name);
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
CREATE INDEX IF NOT EXISTS idx_products_name_trgm ON products USING gin (name extensions.gin_trgm_ops);

ALTER TABLE products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS products_select ON products;
CREATE POLICY products_select ON products FOR SELECT USING (is_account_member(account_id));
DROP POLICY IF EXISTS products_insert ON products;
CREATE POLICY products_insert ON products FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS products_update ON products;
CREATE POLICY products_update ON products FOR UPDATE USING (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS products_delete ON products;
CREATE POLICY products_delete ON products FOR DELETE USING (is_account_member(account_id, 'admin'));

-- ── Quotes ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS quotes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  number           TEXT NOT NULL,
  contact_id       UUID REFERENCES contacts(id) ON DELETE SET NULL,
  deal_id          UUID REFERENCES deals(id) ON DELETE SET NULL,
  conversation_id  UUID REFERENCES conversations(id) ON DELETE SET NULL,
  status           TEXT NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'sent', 'accepted', 'rejected')),
  currency         TEXT NOT NULL DEFAULT 'USD',
  tax_label        TEXT NOT NULL DEFAULT 'IVA',
  tax_rate         NUMERIC(5, 2) NOT NULL DEFAULT 0,
  prices_include_tax BOOLEAN NOT NULL DEFAULT FALSE,
  subtotal         NUMERIC(12, 2) NOT NULL DEFAULT 0,
  discount_amount  NUMERIC(12, 2) NOT NULL DEFAULT 0,
  tax_amount       NUMERIC(12, 2) NOT NULL DEFAULT 0,
  total            NUMERIC(12, 2) NOT NULL DEFAULT 0,
  notes            TEXT,
  terms            TEXT,
  valid_until      DATE,
  pdf_url          TEXT,
  created_by       UUID,
  sent_at          TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, number)
);
CREATE INDEX IF NOT EXISTS idx_quotes_contact ON quotes (contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quotes_account_created ON quotes (account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quotes_deal ON quotes (deal_id) WHERE deal_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS quote_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id     UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  product_id   UUID REFERENCES products(id) ON DELETE SET NULL,
  description  TEXT NOT NULL,
  quantity     NUMERIC(12, 2) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price   NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  discount_pct NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (discount_pct >= 0 AND discount_pct <= 100),
  line_total   NUMERIC(12, 2) NOT NULL DEFAULT 0,
  position     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_quote_items_quote ON quote_items (quote_id, position);

ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE quote_items ENABLE ROW LEVEL SECURITY;

-- Any member can read and prepare quotes (advisors quote all day);
-- viewers are read-only; deleting is admin+.
DROP POLICY IF EXISTS quotes_select ON quotes;
CREATE POLICY quotes_select ON quotes FOR SELECT USING (is_account_member(account_id));
DROP POLICY IF EXISTS quotes_insert ON quotes;
CREATE POLICY quotes_insert ON quotes FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
DROP POLICY IF EXISTS quotes_update ON quotes;
CREATE POLICY quotes_update ON quotes FOR UPDATE USING (is_account_member(account_id, 'agent'));
DROP POLICY IF EXISTS quotes_delete ON quotes;
CREATE POLICY quotes_delete ON quotes FOR DELETE USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS quote_items_select ON quote_items;
CREATE POLICY quote_items_select ON quote_items FOR SELECT
  USING (EXISTS (SELECT 1 FROM quotes q WHERE q.id = quote_id AND is_account_member(q.account_id)));
DROP POLICY IF EXISTS quote_items_write ON quote_items;
CREATE POLICY quote_items_write ON quote_items FOR ALL
  USING (EXISTS (SELECT 1 FROM quotes q WHERE q.id = quote_id AND is_account_member(q.account_id, 'agent')))
  WITH CHECK (EXISTS (SELECT 1 FROM quotes q WHERE q.id = quote_id AND is_account_member(q.account_id, 'agent')));

-- Atomic per-account numbering: returns e.g. 'COT-000042' and bumps the counter.
CREATE OR REPLACE FUNCTION public.next_quote_number(p_account_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_prefix text;
  v_n integer;
BEGIN
  UPDATE accounts
     SET quote_next_number = quote_next_number + 1
   WHERE id = p_account_id
  RETURNING quote_prefix, quote_next_number - 1 INTO v_prefix, v_n;
  IF v_n IS NULL THEN
    RAISE EXCEPTION 'account not found';
  END IF;
  RETURN v_prefix || '-' || lpad(v_n::text, 6, '0');
END;
$$;
REVOKE ALL ON FUNCTION public.next_quote_number(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.next_quote_number(uuid) TO service_role;
