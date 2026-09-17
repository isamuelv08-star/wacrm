-- ============================================================
-- 094_contact_intelligence.sql — Fase 7 del motor de inteligencia
-- comercial: "memoria del cliente" — necesidad, presupuesto, objeción
-- y producto de interés, extraídos por la MISMA llamada de IA que ya
-- corre por cada mensaje calificable (src/lib/ai/lead-classify.ts),
-- nunca una llamada nueva — la disciplina de costo de la auditoría.
--
-- Este es el hueco real que la propia auditoría identificó: hoy la IA
-- solo guarda hot/warm/cold + una frase libre
-- (contacts.lead_score_reason). No existía ningún campo estructurado
-- para lo que el cliente realmente dijo que necesita, cuánto puede
-- pagar, qué objeción puso o qué producto le interesa.
--
-- Una fila por contacto (se sobrescribe con lo último confirmado, no
-- se acumula historial — a diferencia de lead_score_history, esto es
-- "lo que sabemos hoy", no una auditoría de cambios). Cada campo es
-- NULL salvo que el cliente lo haya dicho explícitamente — el prompt
-- (defaults.ts::buildClassificationPrompt) instruye a la IA a nunca
-- inventar un valor, y `applyContactIntelligence`
-- (src/lib/ai/lead-classify.ts) nunca escribe una fila cuando los
-- cuatro campos vienen vacíos.
--
-- Idempotente — segura de re-ejecutar.
-- ============================================================

CREATE TABLE IF NOT EXISTS contact_intelligence (
  contact_id         UUID PRIMARY KEY REFERENCES contacts(id) ON DELETE CASCADE,
  account_id          UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  need                TEXT,
  budget              TEXT,
  objection           TEXT,
  product_interest    TEXT,
  -- Traceability: which message this snapshot was extracted from, so
  -- "why does the CRM think this?" always has a real answer (Auditoría
  -- Saleslid's "no inventar datos" principle).
  source_message_id  UUID REFERENCES messages(id) ON DELETE SET NULL,
  source_conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contact_intelligence_account
  ON contact_intelligence (account_id);

ALTER TABLE contact_intelligence ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contact_intelligence_select ON contact_intelligence;
CREATE POLICY contact_intelligence_select ON contact_intelligence FOR SELECT
  USING (is_account_member(account_id));

-- No INSERT/UPDATE/DELETE policy for `authenticated` — written
-- exclusively by the classification call (service role), same posture
-- as sales_signals (091) and promises (092). A manual-edit UI is a
-- natural follow-up once this data has been live long enough to know
-- whether one is actually needed (YAGNI for now).
