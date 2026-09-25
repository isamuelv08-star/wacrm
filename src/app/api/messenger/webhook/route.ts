import { NextResponse, after } from 'next/server'
import { verifyMetaWebhookSignature } from '@/lib/whatsapp/webhook-signature'
import {
  handleMessengerWebhookVerificationGET,
  processMessengerWebhookPayload,
} from '@/lib/messenger/webhook-processor'
import { enqueueWebhook, runQueuedWebhook } from '@/lib/webhooks/inbox'
import { supabaseAdmin as inboxAdmin } from '@/lib/notifications/admin-client'

// See src/app/api/whatsapp/webhook/route.ts for why this runs after()
// the response instead of inline or as a floating promise.
export const maxDuration = 60

// GET - Webhook verification (Meta → Messenger product → Webhooks).
export async function GET(request: Request) {
  return handleMessengerWebhookVerificationGET(request)
}

// POST - Receive Messenger events (messages, delivery/read receipts).
export async function POST(request: Request) {
  const rawBody = await request.text()
  const signature = request.headers.get('x-hub-signature-256')

  // Same App Secret signs both products (WhatsApp and Messenger live
  // under the same Meta App) — verifyMetaWebhookSignature has nothing
  // WhatsApp-specific about it.
  if (!verifyMetaWebhookSignature(rawBody, signature)) {
    console.warn('[messenger webhook] rejected request with invalid signature')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let body: Parameters<typeof processMessengerWebhookPayload>[0]
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Stored before the 200 (migration 112) so a restart mid-processing
  // can't lose it — the webhook-retry cron re-runs anything unfinished.
  const inboxDb = inboxAdmin()
  const inboxId = await enqueueWebhook(inboxDb, 'messenger', body)
  after(async () => {
    try {
      if (inboxId) {
        await runQueuedWebhook(inboxDb, inboxId)
        return
      }
      await processMessengerWebhookPayload(body)
    } catch (error) {
      console.error('[messenger webhook] Error processing webhook:', error)
    }
  })

  return NextResponse.json({ status: 'received' }, { status: 200 })
}
