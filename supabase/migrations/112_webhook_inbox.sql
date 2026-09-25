-- ============================================================
-- 112_webhook_inbox.sql — durable inbound webhooks
--
-- Every webhook route acked the provider with 200 and then processed
-- the event in memory (Next's after()). A restart or deploy in that
-- window (the AI debounce alone keeps it open ~12s) lost the event for
-- good: the provider saw a 200, so it never redelivers.
--
-- Now each verified event is written here BEFORE the 200, processed,
-- and marked done. /api/cron/webhook-retry re-runs anything left
-- pending or stuck in processing — safe, because processing is already
-- idempotent (message ids are deduped per conversation, status ticks
-- only move forward).
--
-- Server-only: RLS on with no policies (service role bypasses it).
--
-- Idempotent — safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.webhook_inbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL CHECK (source IN ('meta', 'dualhook', 'zernio', 'messenger')),
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'done', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ
);

ALTER TABLE public.webhook_inbox ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_webhook_inbox_open
  ON public.webhook_inbox (received_at)
  WHERE status IN ('pending', 'processing');

CREATE INDEX IF NOT EXISTS idx_webhook_inbox_done
  ON public.webhook_inbox (processed_at)
  WHERE status = 'done';
