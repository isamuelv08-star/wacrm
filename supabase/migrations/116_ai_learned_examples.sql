-- ============================================================
-- 116 — The AI learns from how the advisors answer
-- ============================================================
--
-- A nightly job (/api/cron/ai-learning, src/lib/ai/learning) reads the
-- replies human advisors wrote — in the CRM or from the WhatsApp phone
-- app — pairs each with the customer message(s) it answered, strips the
-- customer's personal data, and stores the pair here.
--
--   * Pairs from conversations that ended in a WON deal are approved
--     automatically; the rest wait in "pending" for an admin to approve
--     or reject in Settings → AI (nothing a person hasn't vetted, or that
--     didn't sell, is imitated).
--   * When the AI replies (or drafts), the approved pairs most similar to
--     the customer's current message are shown to it as examples of how
--     this business's own people answer — tone, wording, how they move
--     the sale forward.
--
-- Idempotent.
-- ============================================================

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS learning_enabled BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS ai_learned_examples (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id         UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id    UUID REFERENCES conversations(id) ON DELETE SET NULL,
  -- The advisor message this pair was mined from (dedupe across runs).
  source_message_id  UUID UNIQUE REFERENCES messages(id) ON DELETE SET NULL,
  customer_text      TEXT NOT NULL,
  advisor_reply      TEXT NOT NULL,
  outcome            TEXT NOT NULL DEFAULT 'open' CHECK (outcome IN ('open', 'won', 'lost')),
  status             TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  fts                TSVECTOR GENERATED ALWAYS AS (to_tsvector('simple', customer_text)) STORED,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at        TIMESTAMPTZ,
  reviewed_by        UUID
);

CREATE INDEX IF NOT EXISTS idx_ai_learned_examples_account_status
  ON ai_learned_examples (account_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_learned_examples_fts
  ON ai_learned_examples USING gin (fts);

-- The miner scans recent advisor messages across accounts.
CREATE INDEX IF NOT EXISTS idx_messages_agent_created
  ON messages (created_at) WHERE sender_type = 'agent';

ALTER TABLE ai_learned_examples ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_learned_examples_select ON ai_learned_examples;
CREATE POLICY ai_learned_examples_select ON ai_learned_examples FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS ai_learned_examples_update ON ai_learned_examples;
CREATE POLICY ai_learned_examples_update ON ai_learned_examples FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ai_learned_examples_delete ON ai_learned_examples;
CREATE POLICY ai_learned_examples_delete ON ai_learned_examples FOR DELETE
  USING (is_account_member(account_id, 'admin'));

-- Inserts come from the service role only (the miner).

-- Similar approved examples for a customer message: any word (prefix)
-- match like migration 115, pairs from won deals ranked higher.
CREATE OR REPLACE FUNCTION public.match_ai_learned_examples(
  p_account_id  uuid,
  p_query       text,
  p_match_count integer
)
RETURNS TABLE (id uuid, customer_text text, advisor_reply text, rank real) AS $$
  WITH words AS (
    SELECT DISTINCT w
    FROM regexp_split_to_table(lower(coalesce(p_query, '')), '[^[:alnum:]]+') AS w
    WHERE length(w) >= 3
      AND w NOT IN (
        'que', 'los', 'las', 'del', 'para', 'por', 'con', 'una', 'uno', 'unos', 'unas',
        'hola', 'buenas', 'buenos', 'dias', 'tardes', 'noches', 'gracias', 'favor',
        'como', 'esta', 'este', 'esto', 'eso', 'esa', 'ese', 'sus', 'mis', 'tus',
        'pero', 'más', 'mas', 'muy', 'hay', 'tiene', 'tienen', 'tengo', 'quiero',
        'quisiera', 'saber', 'porfa', 'ustedes',
        'the', 'and', 'for', 'you', 'what', 'how', 'with', 'hello', 'thanks', 'please'
      )
    LIMIT 24
  ),
  q AS (
    SELECT CASE WHEN count(*) = 0 THEN NULL
                ELSE to_tsquery('simple', string_agg(w || ':*', ' | '))
           END AS tsq
    FROM words
  )
  SELECT e.id,
         e.customer_text,
         e.advisor_reply,
         (ts_rank(e.fts, q.tsq) * CASE WHEN e.outcome = 'won' THEN 1.5 ELSE 1 END)::real AS rank
  FROM ai_learned_examples e, q
  WHERE e.account_id = p_account_id
    AND e.status = 'approved'
    AND q.tsq IS NOT NULL
    AND e.fts @@ q.tsq
  ORDER BY rank DESC, e.created_at DESC
  LIMIT LEAST(GREATEST(p_match_count, 0), 10);
$$ LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public;

REVOKE ALL ON FUNCTION public.match_ai_learned_examples(uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_ai_learned_examples(uuid, text, integer) TO authenticated, service_role;
