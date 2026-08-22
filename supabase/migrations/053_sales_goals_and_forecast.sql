-- ============================================================
-- 053_sales_goals_and_forecast.sql — CEO dashboard foundation
--
-- Three independent additions, none of which existed before:
--
--   1. sales_goals — monthly revenue targets. A row with user_id
--      NULL is the account's overall goal; a row with user_id set
--      is that member's individual quota for the month. Nothing in
--      this schema could infer a goal from existing data — it's a
--      number the account owner/admin enters, same as
--      accounts.default_currency.
--
--   2. pipeline_stages.win_probability — % chance a deal in this
--      stage eventually closes won, used to weight the pipeline into
--      a forecast (sum(deal.value * stage.win_probability / 100) over
--      open deals). Backfilled with a linear ramp by stage position
--      so the forecast isn't zero/undefined before an admin tunes it
--      in Settings — same "reasonable default, then user-editable"
--      posture as deals.currency defaulting to 'USD'.
--
--   3. deals.closed_at — deals had no "when did this actually close"
--      timestamp; only updated_at, which also moves on unrelated
--      edits (title, notes, value). A trigger stamps closed_at the
--      moment status flips to won/lost, and clears it if a deal is
--      re-opened — mirrors record_deal_stage_change (039)'s
--      "system-populated, no client write policy needed" posture,
--      since it's fully derived from status.
--
-- Idempotent — safe to re-run.
-- ============================================================

-- ------------------------------------------------------------
-- 1. sales_goals
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sales_goals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- NULL = the account's overall monthly goal. Set = that member's
  -- individual quota. ON DELETE CASCADE: a removed member's quota
  -- history goes with them (the account-level goal is unaffected,
  -- since those rows have user_id NULL and never reference profiles).
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  -- Always the first of the month — one row per account/member per
  -- calendar month. A DATE (not just year+month ints) so range
  -- queries (BETWEEN, date_trunc) stay simple.
  period_month DATE NOT NULL,
  target_value NUMERIC(12,2) NOT NULL CHECK (target_value >= 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sales_goals_period_is_month_start CHECK (period_month = date_trunc('month', period_month)::date)
);

-- Postgres treats NULLs as distinct for a plain UNIQUE constraint, so
-- a single UNIQUE(account_id, user_id, period_month) would silently
-- allow multiple account-level (user_id NULL) rows for the same
-- month. Two partial unique indexes instead — same trick as the
-- "at most one qualified stage per pipeline" index in 038.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_goals_account_period
  ON sales_goals (account_id, period_month)
  WHERE user_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_goals_member_period
  ON sales_goals (account_id, user_id, period_month)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sales_goals_account
  ON sales_goals (account_id, period_month);

ALTER TABLE sales_goals ENABLE ROW LEVEL SECURITY;

-- Everyone in the account can read goals (the Top Sellers leaderboard
-- shows every member's quota attainment %, not just the caller's own).
-- Only admin+ can set them — same ceiling as accounts.default_currency
-- (DealsSettings) and pipeline_stages (admin-only "modify" policy).
DROP POLICY IF EXISTS sales_goals_select ON sales_goals;
CREATE POLICY sales_goals_select ON sales_goals FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS sales_goals_insert ON sales_goals;
CREATE POLICY sales_goals_insert ON sales_goals FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS sales_goals_update ON sales_goals;
CREATE POLICY sales_goals_update ON sales_goals FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS sales_goals_delete ON sales_goals;
CREATE POLICY sales_goals_delete ON sales_goals FOR DELETE
  USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON sales_goals;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON sales_goals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ------------------------------------------------------------
-- 2. pipeline_stages.win_probability
-- ------------------------------------------------------------
ALTER TABLE pipeline_stages
  ADD COLUMN IF NOT EXISTS win_probability INTEGER
    CHECK (win_probability IS NULL OR win_probability BETWEEN 0 AND 100);

-- Backfill: a linear ramp by position within each pipeline (last
-- stage = highest probability) so an account that never opens the
-- new Settings panel still gets a non-zero forecast. Only touches
-- rows that don't have a value yet, so re-running this migration
-- can't clobber probabilities an admin has already tuned.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (PARTITION BY pipeline_id ORDER BY position) AS rn,
    COUNT(*) OVER (PARTITION BY pipeline_id) AS total
  FROM pipeline_stages
  WHERE win_probability IS NULL
)
UPDATE pipeline_stages ps
SET win_probability = GREATEST(5, LEAST(95, ROUND((ranked.rn::numeric / NULLIF(ranked.total, 0)) * 100)))
FROM ranked
WHERE ps.id = ranked.id;

-- ------------------------------------------------------------
-- 3. deals.closed_at
-- ------------------------------------------------------------
ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

-- Best-effort backfill for deals already closed before this
-- migration existed — updated_at is an approximation (the last edit
-- isn't guaranteed to be the status change), but it's the closest
-- signal available and only affects historical rows.
UPDATE deals
SET closed_at = updated_at
WHERE status IN ('won', 'lost') AND closed_at IS NULL;

CREATE OR REPLACE FUNCTION set_deal_closed_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IN ('won', 'lost') THEN
    -- Only stamp on the transition INTO a closed state — an unrelated
    -- edit to an already-closed deal (e.g. fixing a typo in notes)
    -- must not push closed_at forward and skew the sales-cycle metric.
    -- TG_OP is checked with its own IF (not `OR`'d into one boolean
    -- expression) so OLD is never dereferenced on INSERT, when it
    -- doesn't exist as a valid record.
    IF TG_OP = 'INSERT' THEN
      NEW.closed_at := NOW();
    ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
      NEW.closed_at := NOW();
    END IF;
  ELSE
    -- Re-opening a deal (won/lost -> open) clears it; the deal isn't
    -- closed anymore, so it shouldn't count in closed-deal reporting.
    NEW.closed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_deal_status_closed ON deals;
CREATE TRIGGER on_deal_status_closed
  BEFORE INSERT OR UPDATE OF status ON deals
  FOR EACH ROW EXECUTE FUNCTION set_deal_closed_at();

CREATE INDEX IF NOT EXISTS idx_deals_closed_at ON deals (account_id, closed_at) WHERE closed_at IS NOT NULL;
