-- ============================================================
-- 092_promise_tracker.sql — Fase 4 del motor de inteligencia
-- comercial: detecta compromisos verbales que un vendedor le hace a
-- un cliente por WhatsApp ("te confirmo en 10 minutos", "mañana te
-- mando el precio") y los vigila hasta que se cumplen o vencen.
--
--   1. `promises`              — un compromiso detectado, con su
--                                  mensaje de origen (trazabilidad).
--   2. `promise_scan_cursor`   — dónde se quedó el escaneo por cuenta,
--                                  para no re-analizar con IA los
--                                  mismos mensajes en cada corrida.
--   3. `ai_usage_log.mode`     — se amplía con 'promise_extract', la
--                                  llamada de IA dedicada
--                                  (src/lib/ai/promise-extract vía
--                                  generate.ts) que confirma o descarta
--                                  cada candidato detectado por reglas.
--
-- Detección en dos capas, igual que el resto del motor de riesgo: un
-- filtro determinista y barato (palabras/frases clave) decide qué
-- mensajes vale la pena mandarle a la IA — nunca se llama a la IA por
-- cada mensaje saliente, solo por los candidatos reales
-- (src/lib/sales-intelligence/promise-detect.ts).
--
-- Idempotente — segura de re-ejecutar.
-- ============================================================

CREATE TABLE IF NOT EXISTS promises (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id    UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  contact_id         UUID REFERENCES contacts(id) ON DELETE SET NULL,
  -- auth.users.id, snapshotted from conversations.assigned_agent_id at
  -- detection time — same convention that column itself uses (no FK
  -- there historically; adding one here since this is new data, not a
  -- copy of an existing gap). Null if the conversation was unassigned
  -- when the promise was made.
  promised_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  promise_text       TEXT NOT NULL,
  -- Traceability: every fact this feature surfaces must point back to
  -- where it came from (Auditoría Saleslid's "no inventar datos").
  source_message_id  UUID REFERENCES messages(id) ON DELETE SET NULL,
  due_at             TIMESTAMPTZ NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'completed', 'overdue', 'cancelled')),
  -- 'manual' is reserved for a future "log a promise yourself" entry
  -- point — not built yet, but the column already accommodates it.
  detected_by         TEXT NOT NULL DEFAULT 'ai' CHECK (detected_by IN ('ai', 'manual')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_promises_account_status
  ON promises (account_id, status);

-- What the overdue sweep scans on every cron tick.
CREATE INDEX IF NOT EXISTS idx_promises_pending_due
  ON promises (due_at)
  WHERE status = 'pending';

ALTER TABLE promises ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS promises_select ON promises;
CREATE POLICY promises_select ON promises FOR SELECT
  USING (is_account_member(account_id));

-- No INSERT/UPDATE/DELETE policy for `authenticated` yet — written
-- exclusively by the promise-tracker cron via the service role, same
-- posture as sales_signals (091). A "mark as done" action for a human
-- to close a promise early is a follow-up (fase 5, alongside the Sales
-- Leak Detector, which is what actually surfaces a broken promise as a
-- leak) — deliberately not built here (YAGNI until that UI exists).

-- ------------------------------------------------------------
-- Scan bookkeeping: the last message timestamp already considered per
-- account, so the cron only ever looks at NEW agent messages instead
-- of re-scanning (and re-paying to AI-check) the same history every
-- ~5 minutes. Service-role only, no client access needed at all.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS promise_scan_cursor (
  account_id                    UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  last_scanned_message_created_at TIMESTAMPTZ NOT NULL,
  updated_at                     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE promise_scan_cursor ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS promise_scan_cursor_select ON promise_scan_cursor;
CREATE POLICY promise_scan_cursor_select ON promise_scan_cursor FOR SELECT
  USING (is_account_member(account_id, 'admin'));

-- ------------------------------------------------------------
-- Widen ai_usage_log.mode for the new dedicated promise-extraction
-- call (src/lib/ai/generate.ts::generatePromiseExtraction) — same
-- treatment migration 061 gave 'classify'.
-- ------------------------------------------------------------
ALTER TABLE ai_usage_log
  DROP CONSTRAINT IF EXISTS ai_usage_log_mode_check;

ALTER TABLE ai_usage_log
  ADD CONSTRAINT ai_usage_log_mode_check CHECK (mode IN ('auto_reply', 'draft', 'classify', 'promise_extract'));
