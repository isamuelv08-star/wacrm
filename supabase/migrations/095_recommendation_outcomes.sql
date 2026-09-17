-- ============================================================
-- 095_recommendation_outcomes.sql — Fase 8: cierra el ciclo
-- OBSERVAR → RECOMENDAR → EJECUTAR → RESULTADO → APRENDER sobre datos
-- que YA existen, sin construir una UI de seguimiento nueva.
--
-- `sales_signals` (fase 1) ya tiene el único estado que este esquema
-- puede honestamente medir: una señal está abierta, y en algún
-- momento se resuelve (deja de dispararse en una corrida del Risk
-- Engine). Cada vez que eso pasa, se registra cuánto tardó — eso ya es
-- "¿esta recomendación se resolvió, y en cuánto tiempo?", sin
-- necesitar que nadie marque nada manualmente.
--
-- Deliberadamente NO intenta trackear el resultado de Next Best Action
-- (fase 3) — esa lista es calculada al vuelo desde deals/promises en
-- cada carga, no tiene un registro persistente propio del que medir
-- una transición abierto→resuelto sin inventar un mecanismo de
-- tracking nuevo (la propia auditoría: "no crear procesos manuales
-- adicionales"). Si en el futuro se agrega una acción explícita
-- ("marcar como hecho"), esa sí generará una fila aquí.
--
-- Solo lectura para admin+ — tabla de analítica interna, sin UI
-- todavía (igual que sales_signals en su momento).
--
-- Idempotente — segura de re-ejecutar.
-- ============================================================

CREATE TABLE IF NOT EXISTS recommendation_outcomes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  signal_type     TEXT NOT NULL,
  severity        TEXT NOT NULL,
  opened_at       TIMESTAMPTZ NOT NULL,
  resolved_at     TIMESTAMPTZ NOT NULL,
  -- Precomputed rather than derived on every read — this is exactly
  -- the number the Learning Loop will eventually aggregate ("does
  -- 'high' severity resolve faster than 'medium'?").
  duration_hours  NUMERIC NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recommendation_outcomes_account_type
  ON recommendation_outcomes (account_id, signal_type);

ALTER TABLE recommendation_outcomes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS recommendation_outcomes_select ON recommendation_outcomes;
CREATE POLICY recommendation_outcomes_select ON recommendation_outcomes FOR SELECT
  USING (is_account_member(account_id, 'admin'));

-- No INSERT/UPDATE/DELETE policy for `authenticated` — written
-- exclusively by the risk-engine cron (service role), same posture as
-- every other fase-1-through-7 table.
