import crypto from 'node:crypto'
import { NextResponse, after } from 'next/server'
import {
  processMessage,
  supabaseAdmin,
  type WhatsAppMessage,
} from '@/lib/whatsapp/webhook-processor'

// ============================================================
// Inbound webhook for WhatsApp accounts connected through Zernio.
//
// Zernio is NOT a thin Cloud-API broker — it holds the Meta
// credentials itself and pushes inbound messages to a webhook
// subscription WE register with it (see scripts/zernio-setup-webhook.js),
// signed with a shared secret rather than Meta's own app-secret HMAC
// (that's what the direct-Meta and Dualhook routes verify instead).
// One subscription covers every Zernio-connected account on this
// self-hosted instance — the payload's `account.id` tells us which
// one, resolved against `client_zernio_accounts.whatsapp_account_id`.
//
// This route only adapts Zernio's `message.received` shape into the
// same `WhatsAppMessage` + contact shape the direct-Meta pipeline
// already consumes, then hands off to the exact same `processMessage`
// — so automations, Flows, AI auto-reply, notifications, round-robin
// assignment, and lead-deal creation all work identically regardless
// of which provider delivered the message.
//
// Known gaps in this first pass (all silently degrade rather than
// crash): reactions, click-to-WhatsApp referral capture, Flow (nfm_reply)
// submissions, and voice-transcription/image-description (both Meta-only,
// see webhook-processor.ts). Swipe-replies, button/list taps, text, and
// image/video/document/audio all work.
// ============================================================

export const maxDuration = 60

// Zernio's docs: "The signature is the lowercase hex HMAC-SHA256 of
// the raw request body keyed by your webhook secret", header
// `X-Zernio-Signature` (legacy alias `X-Late-Signature`).
function verifyZernioSignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.ZERNIO_WEBHOOK_SECRET
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
interface ZernioWebhookPayload {
  event: string
  account?: { id?: string; platform?: string }
  message?: {
    platform?: string
    platformMessageId?: string
    direction?: 'incoming' | 'outgoing'
    text?: string | null
    attachments?: Array<{ type: string; url: string }>
    sender?: {
      id?: string
      name?: string
      phoneNumber?: string | null
    }
    sentAt?: string
  }
  conversation?: { id?: string }
  metadata?: {
    quotedMessageId?: string
    interactiveType?: 'button_reply' | 'list_reply' | 'nfm_reply'
    interactiveId?: string
  } | null
}

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
  after(async () => {
    try {
      await processZernioEvent(payload)
    } catch (error) {
      console.error('[webhook/zernio] processing failed:', error)
    }
  })

  return NextResponse.json({ status: 'received' }, { status: 200 })
}

async function processZernioEvent(payload: ZernioWebhookPayload) {
  if (payload.event !== 'message.received') return
  const message = payload.message
  const account = payload.account
  if (!message || !account?.id) return

  // Only WhatsApp is bridged today (Instagram connect exists in
  // Settings but has no send/receive pipeline yet either — out of
  // scope for this pass).
  if (message.platform !== 'whatsapp') return

  // Echoes of our own outbound sends (or a reply typed from Zernio's
  // own native dashboard, outside this CRM). Skipping avoids inserting
  // a duplicate of a message sendMessageToConversation already
  // persisted when it sent via the Zernio bridge.
  if (message.direction !== 'incoming') return

  const { data: zernioAccount, error: zernioAccountError } = await supabaseAdmin()
    .from('client_zernio_accounts')
    .select('account_id, connected_by_user_id')
    .eq('whatsapp_account_id', account.id)
    .maybeSingle()

  if (zernioAccountError) {
    console.error('[webhook/zernio] account lookup failed:', zernioAccountError.message)
    return
  }
  if (!zernioAccount) {
    console.warn('[webhook/zernio] no account matches Zernio accountId:', account.id)
    return
  }
  if (!zernioAccount.connected_by_user_id) {
    console.error(
      '[webhook/zernio] account has no connected_by_user_id (connected before migration 056) — reconnect WhatsApp in Settings to fix:',
      account.id,
    )
    return
  }

  const senderPhone = message.sender?.id || message.sender?.phoneNumber?.replace(/^\+/, '')
  if (!senderPhone) {
    console.warn('[webhook/zernio] message has no resolvable sender phone; skipping')
    return
  }

  const adapted = adaptZernioMessage(message, payload.metadata, senderPhone)

  await processMessage(
    adapted,
    { profile: { name: message.sender?.name || senderPhone }, wa_id: senderPhone },
    zernioAccount.account_id,
    zernioAccount.connected_by_user_id,
    '', // no Meta access token for a Zernio-bridged account
    'zernio',
  )

  // Stamp the conversation with Zernio's own conversation id, so any
  // reply (AI auto-reply, a human agent, Flows, Automations) sends via
  // POST /v1/inbox/conversations/{id}/messages — the reply path Zernio
  // actually supports for text/media/interactive — instead of wrongly
  // trying to cold-start a NEW conversation (POST /v1/inbox/conversations,
  // which only accepts a template or a Direct-Send-eligible message).
  // Without this, every reply looked like a business-initiated opener
  // even seconds after the customer just texted in, and got rejected
  // by Meta with "Direct Send is not enabled for this WhatsApp account."
  //
  // Resolved via the message we just inserted (by its wamid) rather
  // than threading a return value through processMessage's several
  // early-exit paths — cheap, and a miss here (e.g. the reaction
  // short-circuit, which never inserts into `messages`) just means the
  // NEXT real inbound text sets it, not a lost message.
  if (payload.conversation?.id) {
    const { data: insertedMsg } = await supabaseAdmin()
      .from('messages')
      .select('conversation_id, conversations(zernio_conversation_id)')
      .eq('message_id', adapted.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const conv = insertedMsg?.conversations as { zernio_conversation_id: string | null } | null
    if (insertedMsg && conv?.zernio_conversation_id !== payload.conversation.id) {
      const { error: stampError } = await supabaseAdmin()
        .from('conversations')
        .update({ zernio_conversation_id: payload.conversation.id })
        .eq('id', insertedMsg.conversation_id)
      if (stampError) {
        console.error('[webhook/zernio] failed to stamp zernio_conversation_id:', stampError.message)
      }
    }
  }
}

/**
 * Convert Zernio's message shape into the same `WhatsAppMessage`
 * shape processMessage() already knows how to handle (see the type's
 * doc comment in webhook-processor.ts). Media attachments get a
 * synthetic "id": the base64url-encoded original Zernio attachment
 * URL, which /api/whatsapp/media/zernio/[token]/route.ts decodes and
 * proxies through with the Zernio API key attached server-side —
 * there's no bare Meta media id to hand out here the way there is on
 * the direct-Meta path.
 */
function adaptZernioMessage(
  message: NonNullable<ZernioWebhookPayload['message']>,
  metadata: ZernioWebhookPayload['metadata'],
  senderPhone: string,
): WhatsAppMessage {
  const id = message.platformMessageId || ''
  const timestamp = message.sentAt
    ? String(Math.floor(new Date(message.sentAt).getTime() / 1000))
    : String(Math.floor(Date.now() / 1000))

  const base: WhatsAppMessage = { id, from: senderPhone, timestamp, type: 'text' }

  if (metadata?.interactiveType === 'button_reply' && metadata.interactiveId) {
    return {
      ...base,
      type: 'interactive',
      interactive: {
        type: 'button_reply',
        button_reply: { id: metadata.interactiveId, title: message.text || metadata.interactiveId },
      },
    }
  }
  if (metadata?.interactiveType === 'list_reply' && metadata.interactiveId) {
    return {
      ...base,
      type: 'interactive',
      interactive: {
        type: 'list_reply',
        list_reply: { id: metadata.interactiveId, title: message.text || metadata.interactiveId },
      },
    }
  }

  const attachment = message.attachments?.[0]
  if (attachment) {
    const token = Buffer.from(attachment.url, 'utf8').toString('base64url')
    const withContext = (m: WhatsAppMessage): WhatsAppMessage =>
      metadata?.quotedMessageId ? { ...m, context: { id: metadata.quotedMessageId } } : m

    switch (attachment.type) {
      case 'image':
        return withContext({
          ...base,
          type: 'image',
          image: { id: token, mime_type: '', caption: message.text || undefined },
        })
      case 'sticker':
        return withContext({
          ...base,
          type: 'sticker',
          sticker: { id: token, mime_type: '' },
        })
      case 'video':
        return withContext({
          ...base,
          type: 'video',
          video: { id: token, mime_type: '', caption: message.text || undefined },
        })
      case 'audio':
        return withContext({
          ...base,
          type: 'audio',
          audio: { id: token, mime_type: '' },
        })
      default:
        return withContext({
          ...base,
          type: 'document',
          document: { id: token, mime_type: '', caption: message.text || undefined },
        })
    }
  }

  const withText: WhatsAppMessage = {
    ...base,
    type: 'text',
    text: { body: message.text || '' },
  }
  return metadata?.quotedMessageId
    ? { ...withText, context: { id: metadata.quotedMessageId } }
    : withText
}
