import crypto from 'node:crypto'
import { NextResponse, after } from 'next/server'
import { zernioWebhookSecret } from '@/lib/whatsapp/zernio-env'
import {
  processZernioEvent,
  type ZernioWebhookPayload,
} from '@/lib/whatsapp/zernio-webhook-processor'
import { enqueueWebhook, runQueuedWebhook } from '@/lib/webhooks/inbox'
import { supabaseAdmin as inboxAdmin } from '@/lib/notifications/admin-client'

// Inbound webhook for WhatsApp accounts connected through Zernio — see
// src/lib/whatsapp/zernio-webhook-processor.ts for the processing.

// Same headroom reasoning as the direct-Meta/Dualhook routes: AI
// auto-reply's debounce wait (~12s) plus the provider's own request
// timeout can add up on top of ordinary processing.
export const maxDuration = 120

// Zernio's docs: "The signature is the lowercase hex HMAC-SHA256 of
// the raw request body keyed by your webhook secret", header
// `X-Zernio-Signature` (legacy alias `X-Late-Signature`).
function verifyZernioSignature(rawBody: string, signature: string | null): boolean {
  const secret = zernioWebhookSecret()
  if (!secret || !signature) return false

  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')

  const sigBuf = Buffer.from(signature)
  const expectedBuf = Buffer.from(expected)
  if (sigBuf.length !== expectedBuf.length) return false
  return crypto.timingSafeEqual(sigBuf, expectedBuf)
}

// Slim shape of the fields we actually read off Zernio's
// WebhookPayloadMessage — see the full schema in @zernio/node's
// generated types (InboxWebhookMessage / InboxWebhookAccount /
// InboxWebhookConversation) if this ever needs to grow.
export async function GET() {
  // No Meta-style hub.challenge handshake on this route — Zernio's own
  // dashboard is where the webhook subscription is created/verified
  // (see scripts/zernio-setup-webhook.js); this endpoint only ever receives
  // signed POSTs.
  return NextResponse.json({ status: 'ok' })
}

export async function POST(request: Request) {
  const rawBody = await request.text()
  const signature =
    request.headers.get('x-zernio-signature') || request.headers.get('x-late-signature')

  if (!verifyZernioSignature(rawBody, signature)) {
    console.warn('[webhook/zernio] rejected request with invalid signature')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let payload: ZernioWebhookPayload
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Ack fast, keep processing alive via after() — identical reasoning
  // to the direct-Meta and Dualhook routes (issue #301: a detached
  // promise can be frozen mid-flight on serverless).
  // Stored before the 200 (migration 112) so a restart mid-processing
  // can't lose it — the webhook-retry cron re-runs anything unfinished.
  const inboxDb = inboxAdmin()
  const inboxId = await enqueueWebhook(inboxDb, 'zernio', payload)
  after(async () => {
    try {
      if (inboxId) {
        await runQueuedWebhook(inboxDb, inboxId)
        return
      }
      await processZernioEvent(payload)
    } catch (error) {
      console.error('[webhook/zernio] processing failed:', error)
    }
  })

  return NextResponse.json({ status: 'received' }, { status: 200 })
}
