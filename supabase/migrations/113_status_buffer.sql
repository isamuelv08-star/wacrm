-- ============================================================
-- 113_status_buffer.sql — don't lose early delivery/read ticks
--
-- A status event (sent/delivered/read/failed) can arrive BEFORE the row
-- it belongs to exists: sends store their row (or a broadcast
-- recipient's whatsapp_message_id) only after the provider answers, and
-- the first status can beat that write. Those events matched nothing
-- and were dropped — ticks stuck on "sent", broadcast counters short.
--
-- Unmatched statuses are parked here and re-applied by the
-- webhook-retry cron for up to an hour (src/lib/whatsapp/webhook-processor.ts
-- replayBufferedStatuses). Server-only: RLS on, no policies.
--
-- Idempotent — safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.status_buffer (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id TEXT NOT NULL,
  status TEXT NOT NULL,
  status_timestamp TEXT NOT NULL,
  recipient_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.status_buffer ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_status_buffer_created ON public.status_buffer (created_at);
