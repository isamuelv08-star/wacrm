import type { SupabaseClient } from '@supabase/supabase-js'
import { processWebhookPayload, type WhatsAppWebhookEntry } from '@/lib/whatsapp/webhook-processor'
import { processMessengerWebhookPayload } from '@/lib/messenger/webhook-processor'
import { processZernioEvent, type ZernioWebhookPayload } from '@/lib/whatsapp/zernio-webhook-processor'

/**
 * Durable inbound webhooks (migration 112). The routes store each
 * verified event BEFORE acking the provider, process it, and mark it
 * done; the retry cron re-runs anything a restart interrupted. See the
 * migration for why.
 */

export type WebhookSource = 'meta' | 'dualhook' | 'zernio' | 'messenger'

const MAX_ATTEMPTS = 5
/** A pending row younger than this is still being handled by its request. */
const PENDING_GRACE_MS = 2 * 60_000
/** A processing row older than this was interrupted (restart/crash). */
const STUCK_PROCESSING_MS = 10 * 60_000
const RETRY_BATCH = 20
const KEEP_DONE_DAYS = 7

/** Run one event through the processor for its source. */
export async function processWebhookEvent(source: WebhookSource, payload: unknown): Promise<void> {
  switch (source) {
    case 'meta':
      return processWebhookPayload(payload as { entry?: WhatsAppWebhookEntry[] })
    case 'dualhook':
      return processWebhookPayload(payload as { entry?: WhatsAppWebhookEntry[] }, {
        coexistenceOnly: true,
      })
    case 'zernio':
      return processZernioEvent(payload as ZernioWebhookPayload)
    case 'messenger':
      return processMessengerWebhookPayload(
        payload as Parameters<typeof processMessengerWebhookPayload>[0],
      )
  }
}

/**
 * Store a verified event. Returns its id, or null when it couldn't be
 * stored (e.g. migration 112 not applied yet) — the caller then just
 * processes it in memory, exactly as before.
 */
export async function enqueueWebhook(
  db: SupabaseClient,
  source: WebhookSource,
  payload: unknown,
): Promise<string | null> {
  const { data, error } = await db
    .from('webhook_inbox')
    .insert({ source, payload })
    .select('id')
    .single()
  if (error || !data) {
    if (error && !/webhook_inbox/.test(error.message)) {
      console.error('[webhook-inbox] enqueue failed:', error.message)
    }
    return null
  }
  return data.id as string
}

/**
 * Process a stored event and record the outcome. Claims the row first
 * (pending → processing) so the request that stored it and the retry
 * cron can't both run it at once. Never throws.
 */
export async function runQueuedWebhook(db: SupabaseClient, id: string): Promise<void> {
  const { data: row, error } = await db
    .from('webhook_inbox')
    .select('id, source, payload, attempts, status')
    .eq('id', id)
    .maybeSingle()
  if (error || !row || row.status === 'done') return

  const { data: claimed } = await db
    .from('webhook_inbox')
    .update({ status: 'processing', attempts: (row.attempts as number) + 1, started_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', row.status as string)
    .eq('attempts', row.attempts as number)
    .select('id')
    .maybeSingle()
  if (!claimed) return // someone else took it

  try {
    await processWebhookEvent(row.source as WebhookSource, row.payload)
    await db
      .from('webhook_inbox')
      .update({ status: 'done', processed_at: new Date().toISOString(), last_error: null })
      .eq('id', id)
  } catch (err) {
    const attempts = (row.attempts as number) + 1
    console.error('[webhook-inbox] processing failed for', id, err)
    await db
      .from('webhook_inbox')
      .update({
        status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
        last_error: err instanceof Error ? err.message : String(err),
      })
      .eq('id', id)
  }
}

/**
 * Cron: re-run events left pending (their request died before
 * processing) or stuck in processing (a restart mid-run), then prune
 * old completed rows.
 */
export async function runWebhookRetryScan(
  db: SupabaseClient,
): Promise<{ retried: number; pruned: number }> {
  const now = Date.now()
  const pendingBefore = new Date(now - PENDING_GRACE_MS).toISOString()
  const stuckBefore = new Date(now - STUCK_PROCESSING_MS).toISOString()

  const [{ data: pending }, { data: stuck }] = await Promise.all([
    db
      .from('webhook_inbox')
      .select('id')
      .eq('status', 'pending')
      .lte('received_at', pendingBefore)
      .lt('attempts', MAX_ATTEMPTS)
      .order('received_at', { ascending: true })
      .limit(RETRY_BATCH),
    db
      .from('webhook_inbox')
      .select('id')
      .eq('status', 'processing')
      .lte('started_at', stuckBefore)
      .order('received_at', { ascending: true })
      .limit(RETRY_BATCH),
  ])

  // An interrupted run goes back to pending so runQueuedWebhook can claim it.
  for (const r of (stuck ?? []) as { id: string }[]) {
    await db.from('webhook_inbox').update({ status: 'pending' }).eq('id', r.id).eq('status', 'processing')
  }

  let retried = 0
  // Oldest first, one at a time — events for the same conversation
  // should apply in arrival order.
  for (const r of [...((pending ?? []) as { id: string }[]), ...((stuck ?? []) as { id: string }[])]) {
    await runQueuedWebhook(db, r.id)
    retried++
  }

  const keepAfter = new Date(now - KEEP_DONE_DAYS * 86_400_000).toISOString()
  const { count } = await db
    .from('webhook_inbox')
    .delete({ count: 'exact' })
    .eq('status', 'done')
    .lt('processed_at', keepAfter)

  return { retried, pruned: count ?? 0 }
}
