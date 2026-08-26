-- ============================================================
-- 062_message_delivery_dedup.sql — protect against Meta webhook
-- redelivery duplicating an inbound message
--
-- Meta's webhook delivery is documented as "at least once", not
-- exactly-once — a slow ack, a transient error, or Meta's own retry
-- logic can redeliver the identical event. Without a guard, a
-- redelivery re-inserts the same message, double-counts unread_count,
-- and re-fires automations/flows/AI auto-reply/lead-scoring for the
-- same customer turn — in the worst case sending an automated reply
-- to the customer twice.
--
-- `messages.message_id` is deliberately NOT globally unique (migration
-- 009 — Meta ids repeat across different WhatsApp numbers), so the
-- safe dedup key is the pair (conversation_id, message_id): within one
-- conversation, the same Meta message id can only ever be the same
-- physical message.
--
-- Application code (webhook-processor.ts) checks for an existing row
-- before doing any work, AND catches a unique-violation on the insert
-- itself as the race-safe fallback (mirrors the existing
-- findOrCreateContact / findOrCreateConversation pattern). This index
-- is what makes that catch meaningful — without it, two concurrent
-- redeliveries could both pass the pre-check and both insert.
--
-- Wrapped in a DO block rather than a bare CREATE UNIQUE INDEX: an
-- account that already accumulated duplicate (conversation_id,
-- message_id) rows from a past redelivery would otherwise fail this
-- entire migration outright. Skip with a warning instead — the
-- application-level pre-check above still protects new inbound
-- messages either way; re-run this migration after cleaning up any
-- existing duplicates to add the race-safe constraint too.
--
-- Idempotent — safe to re-run.
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'idx_messages_conversation_message_id_unique'
  ) THEN
    BEGIN
      CREATE UNIQUE INDEX idx_messages_conversation_message_id_unique
        ON messages (conversation_id, message_id)
        WHERE message_id IS NOT NULL;
    EXCEPTION WHEN unique_violation THEN
      RAISE WARNING 'idx_messages_conversation_message_id_unique skipped — existing duplicate (conversation_id, message_id) rows found. Clean those up, then re-run this migration to add the constraint.';
    END;
  END IF;
END $$;
