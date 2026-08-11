import crypto from 'node:crypto'
import { NextResponse, after } from 'next/server'
import {
  handleWebhookVerificationGET,
  processWebhookPayload,
  type WhatsAppWebhookEntry,
} from '@/lib/whatsapp/webhook-processor'

// Webhook route for Coexistence connections (e.g. Dualhook).
//
// A Coexistence provider registers with Meta as the connection's
// "business platform" and proxies inbound webhook deliveries to us.
// That means META SIGNS THE PAYLOAD WITH THE PROVIDER'S APP SECRET,
// not ours — `x-hub-signature-256` can't be verified against
// `META_APP_SECRET` the way the direct-Meta route
// (`/api/whatsapp/webhook/route.ts`) does. Instead, this route is
// authenticated by a secret embedded in the URL itself
// (`DUALHOOK_WEBHOOK_SECRET`), which the provider is configured with
// out of band. Both routes feed the same shared pipeline in
// `src/lib/whatsapp/webhook-processor.ts`.
export const maxDuration = 60

// GET - Webhook verification (identical to the direct-Meta route —
// hub.verify_token has nothing to do with which secret authenticates
// the POST).
export async function GET(request: Request) {
  return handleWebhookVerificationGET(request)
}

// POST - Receive messages, authenticated by the URL secret.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ secret: string }> },
) {
  const { secret } = await params
  const expected = process.env.DUALHOOK_WEBHOOK_SECRET

  // Fail closed — same posture as verifyMetaWebhookSignature for the
  // direct-Meta route: a missing env var must reject every request,
  // not fall open.
  if (!expected || !timingSafeEqualStrings(secret, expected)) {
    // 404, not 401 — a 401 confirms to a prober that a webhook exists
    // at this path and just needs the right secret. 404 makes the
    // route indistinguishable from one that doesn't exist.
    console.warn('[webhook/dualhook] rejected request with invalid secret')
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  let body: { entry?: WhatsAppWebhookEntry[] }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Same after()-based deferred processing as the direct-Meta route —
  // ack fast, but keep the function alive (via `after()`) until the
  // shared pipeline finishes, so serverless freezing can't drop a
  // subset of inbound messages. See the comment in
  // `/api/whatsapp/webhook/route.ts` (issue #301) for why a detached
  // floating promise isn't safe here.
  after(async () => {
    try {
      await processWebhookPayload(body)
    } catch (error) {
      console.error('Error processing Dualhook webhook:', error)
    }
  })

  return NextResponse.json({ status: 'received' }, { status: 200 })
}

/**
 * Constant-time comparison of the URL secret against
 * DUALHOOK_WEBHOOK_SECRET. `crypto.timingSafeEqual` throws on
 * mismatched lengths, so length is checked up front — that check
 * itself leaks length via timing, but the secret is a 64-char hex
 * string with astronomically many candidates, so a length oracle
 * alone isn't an exploitable attack surface.
 */
function timingSafeEqualStrings(a: string, b: string): boolean {
  const aBuf = Buffer.from(a)
  const bBuf = Buffer.from(b)
  if (aBuf.length !== bBuf.length) return false
  return crypto.timingSafeEqual(aBuf, bBuf)
}
