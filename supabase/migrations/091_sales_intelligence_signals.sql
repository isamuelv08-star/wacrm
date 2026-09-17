-- ============================================================
-- 091_sales_intelligence_signals.sql — Fase 1 del motor de
-- inteligencia comercial: `sales_signals`, la primera pieza del Risk
-- Engine descrito en la Auditoría Saleslid.
--
-- Deliberadamente NO reconstruye lo que `loadCeoAlerts`
-- (src/lib/dashboard/ceo-queries.ts) ya calcula — reempaqueta esas
-- mismas seis señales (forecast_gap, low_pipeline_coverage,
-- stalled_deals, win_rate_decline, sales_cycle_increase,
-- at_risk_customers) como filas explicables y con estado, para que
-- una futura vista de gerente (Sales Command Center, fase 2) pueda
-- leerlas sin recalcular nada ni divergir de las tarjetas de alerta
-- que el dashboard de CEO ya muestra hoy.
--
-- Una fila abierta por (account_id, signal_type) — el motor
-- (src/lib/sales-intelligence/risk-engine.ts) la actualiza en su
-- lugar mientras la condición siga activa, y la resuelve en cuanto
-- deja de dispararse, en vez de acumular filas duplicadas.
--
-- `entity_type`/`entity_id` quedan NULL por ahora: las seis señales de
-- la fase 1 son agregados de cuenta, no de un trato puntual. Se dejan
-- declaradas desde ya para que el Sales Leak Detector (fase 5), que sí
-- necesita señales por trato, extienda esta misma tabla en vez de
-- crear una paralela.
--
-- Sin UI todavía: esta migración solo prepara el almacenamiento y dej
-- 0a el motor listo para correr por cron. La sección de dashboard que
-- las muestre es la fase 2.
--
-- Idempotente — segura de re-ejecutar.
-- ============================================================

CREATE TABLE IF NOT EXISTS sales_signals (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  signal_type    TEXT NOT NULL CHECK (signal_type IN (
                   'forecast_gap', 'low_pipeline_coverage', 'stalled_deals',
                   'win_rate_decline', 'sales_cycle_increase', 'at_risk_customers'
                 )),
  severity       TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
  -- 'rule' for every fase-1 signal (deterministic, ported straight
  -- from loadCeoAlerts). 'ai' is declared now so a later fase (Sales
  -- Leak Detector, Promise Tracker) can write into this same table
  -- instead of inventing a second one.
  source         TEXT NOT NULL DEFAULT 'rule' CHECK (source IN ('rule', 'ai')),
  entity_type    TEXT,
  entity_id      UUID,
  -- "Valor potencial afectado" — populated only for signals that are
  -- genuinely about money at risk (stalled_deals today); NULL for
  -- signals measured in points/percent/count (win rate, cycle time,
  -- customer count) rather than currency.
  value_at_risk  NUMERIC,
  -- The raw number the signal is about (percent, count, or coverage
  -- multiple, depending on signal_type) — kept alongside the
  -- human-readable `explanation` so a future UI can format/chart it
  -- without re-parsing prose.
  metric_value   NUMERIC,
  explanation    TEXT NOT NULL,
  evidence       JSONB NOT NULL DEFAULT '{}'::jsonb,
  status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  detected_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The query the engine runs on every scan: "what's still open for this
-- account". Also backs the future Command Center's read.
CREATE INDEX IF NOT EXISTS idx_sales_signals_account_open
  ON sales_signals (account_id, status)
  WHERE status = 'open';

-- At most one OPEN row per (account, signal_type) — the engine updates
-- in place instead of ever inserting a second open row for the same
-- check.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_signals_account_type_open
  ON sales_signals (account_id, signal_type)
  WHERE status = 'open';

ALTER TABLE sales_signals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sales_signals_select ON sales_signals;
CREATE POLICY sales_signals_select ON sales_signals FOR SELECT
  USING (is_account_member(account_id));

-- No INSERT/UPDATE/DELETE policy for `authenticated` — rows are
-- written exclusively by the risk-engine cron job via the service
-- role, same posture as deal_stage_history (039) and lead_score_history
-- (061). A later fase may add a narrow admin-only "dismiss" policy;
-- deliberately left out for now (YAGNI — no UI reads or writes this
-- table yet).
