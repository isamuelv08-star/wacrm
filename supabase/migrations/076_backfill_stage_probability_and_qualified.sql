-- ============================================================
-- 076_backfill_stage_probability_and_qualified.sql — make the CEO
-- forecast and the "reached qualified" pipeline metric work on
-- pipelines created after migrations 053 / 038 ran.
--
-- Two reported bugs, one shared root cause: both metrics read a
-- pipeline_stages column that only a one-time historical backfill ever
-- populated, and the app's own stage-creation paths (the seeded
-- default pipeline, "New pipeline", "Add stage") never wrote either
-- column. So every pipeline created after those migrations has:
--
--   1. win_probability NULL on every stage — loadCeoMetrics skips
--      deals whose stage has no probability, so the dashboard's
--      Forecast card silently under-counts (an account whose stages
--      are all NULL reads a forecast of exactly $0 against a
--      non-empty pipeline).
--
--   2. is_qualified_stage false on every stage — PipelineAnalytics
--      resolves no qualified stage at all and replaces the "Reached
--      qualified" card with the "configure one in settings" notice,
--      even on the default pipeline that ships a "Qualified" /
--      "Calificados" column.
--
-- Same shape as migration 070, which fixed the identical class of
-- problem for is_won_stage/is_lost_stage: a name-based heuristic
-- covering this CRM's actual UI languages, applied only where the
-- pipeline has nothing set, so an admin's explicit choice in Settings
-- is never overridden. Idempotent — safe to re-run.
-- ============================================================

-- ------------------------------------------------------------
-- 1. is_qualified_stage
-- ------------------------------------------------------------
-- Won/lost stages are excluded: a deal that already closed isn't a
-- "qualified lead" step, and 038's partial unique index allows only
-- one qualified stage per pipeline, so the flag has to land on the
-- real mid-funnel column. DISTINCT ON picks the lowest-position match
-- when a pipeline somehow has two, which that same index would
-- otherwise reject.
WITH candidate AS (
  SELECT DISTINCT ON (ps.pipeline_id) ps.id
  FROM pipeline_stages ps
  WHERE ps.name ~* '(qualif|calific)'
    AND NOT ps.is_won_stage
    AND NOT ps.is_lost_stage
    AND NOT EXISTS (
      SELECT 1 FROM pipeline_stages other
      WHERE other.pipeline_id = ps.pipeline_id AND other.is_qualified_stage
    )
  ORDER BY ps.pipeline_id, ps.position
)
UPDATE pipeline_stages ps
SET is_qualified_stage = true
FROM candidate
WHERE ps.id = candidate.id;

-- ------------------------------------------------------------
-- 2. win_probability
-- ------------------------------------------------------------
-- Outcome stages are certainties, not estimates — set them explicitly
-- rather than letting the positional ramp below guess. (The forecast
-- only sums open deals, so these two barely matter to it; they matter
-- for the number an admin sees in the Settings panel.)
UPDATE pipeline_stages SET win_probability = 100
  WHERE win_probability IS NULL AND is_won_stage;
UPDATE pipeline_stages SET win_probability = 0
  WHERE win_probability IS NULL AND is_lost_stage;

-- Linear 10%-90% ramp across the pipeline's OPEN stages, matching
-- computeStageProbability() in pipeline-analytics.tsx so the board's
-- weighted value and the dashboard's forecast agree on an untuned
-- pipeline. Migration 053's version ramped over ALL stages by
-- position, which handed a trailing "Perdidos" column the top
-- probability. The window functions run over every open stage
-- (including ones already tuned) so the ramp stays evenly spaced,
-- while the UPDATE only fills in the NULLs.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (PARTITION BY pipeline_id ORDER BY position) AS rn,
    COUNT(*) OVER (PARTITION BY pipeline_id) AS total
  FROM pipeline_stages
  WHERE NOT is_won_stage AND NOT is_lost_stage
)
UPDATE pipeline_stages ps
SET win_probability = ROUND(
  CASE
    WHEN ranked.total <= 1 THEN 50
    ELSE 10 + ((ranked.rn - 1)::numeric / (ranked.total - 1)) * 80
  END
)
FROM ranked
WHERE ps.id = ranked.id
  AND ps.win_probability IS NULL;
