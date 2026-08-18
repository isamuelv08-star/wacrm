-- ============================================================
-- 047_ai_reply_cap_widen.sql — raise + unbound the auto-reply cap
--
-- Migration 029 capped `ai_configs.auto_reply_max_per_conversation` at
-- 1-20 and made it NOT NULL. Accounts want higher presets (30, 100) and
-- a genuine "never stop" option, not just a bigger number — so:
--
--   - The column becomes nullable: NULL now means "no cap", not just a
--     very large number. `claim_ai_reply_slot` is updated to treat NULL
--     as unlimited (its per-conversation slot claim is the ONLY place
--     that reads this column at send time, so this is the sole
--     enforcement point to change).
--   - The CHECK is widened from 1-20 to 1-1000 for accounts that want a
--     high-but-finite cap instead of true "never stop" (the account-wide
--     rate limiter in src/lib/rate-limit.ts is the separate safety net
--     that still bounds runaway spend even when this is NULL).
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE ai_configs
  DROP CONSTRAINT IF EXISTS ai_configs_auto_reply_max_per_conversation_check;

ALTER TABLE ai_configs
  ALTER COLUMN auto_reply_max_per_conversation DROP NOT NULL;

ALTER TABLE ai_configs
  ADD CONSTRAINT ai_configs_auto_reply_max_per_conversation_check
    CHECK (
      auto_reply_max_per_conversation IS NULL
      OR auto_reply_max_per_conversation BETWEEN 1 AND 1000
    );

-- Same claim semantics as migration 029, plus: a NULL max_replies means
-- unlimited, so the cap half of the WHERE clause is skipped entirely.
CREATE OR REPLACE FUNCTION public.claim_ai_reply_slot(
  conversation_id uuid,
  max_replies integer
)
RETURNS boolean AS $$
  WITH claimed AS (
    UPDATE conversations
    SET ai_reply_count = ai_reply_count + 1
    WHERE id = conversation_id
      AND (max_replies IS NULL OR ai_reply_count < max_replies)
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM claimed);
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;
