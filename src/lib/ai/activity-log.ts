import type { SupabaseClient } from '@supabase/supabase-js'
import type { AiActivityEvent } from '@/types'

// ============================================================
// logAiActivity — append one row to `ai_activity_events` (migration
// 075) so a human watching the Inbox can see what the AI just decided,
// inline in the conversation, as it happens.
//
// Best-effort and non-throwing, same posture as every other AI side-
// effect (lead-scoring.ts, sales-actions.ts, ...): a failure logging
// "what the AI did" must never take down the actual decision it's
// describing, let alone a customer-facing reply that already sent.
// ============================================================

type AiActivityPayload = AiActivityEvent['payload']

export async function logAiActivity(
  db: SupabaseClient,
  args: {
    accountId: string
    /** Null/undefined skips the write entirely — some callers (the
     *  manual lead-score override route) have no conversation to
     *  anchor the event to. */
    conversationId: string | null | undefined
    contactId: string
    eventType: AiActivityEvent['event_type']
    payload?: AiActivityPayload
  },
): Promise<void> {
  const { accountId, conversationId, contactId, eventType, payload = {} } = args
  if (!conversationId) return

  try {
    const { error } = await db.from('ai_activity_events').insert({
      account_id: accountId,
      conversation_id: conversationId,
      contact_id: contactId,
      event_type: eventType,
      payload,
    })
    if (error) {
      console.error('[ai activity-log] failed to insert event:', error.message)
    }
  } catch (err) {
    console.error('[ai activity-log] insert threw:', err)
  }
}
