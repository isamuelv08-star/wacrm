import crypto from 'node:crypto'
import { NextResponse, after } from 'next/server'
import {
  processMessage,
  supabaseAdmin,
  applyMessageStatusUpdate,
  type WhatsAppMessage,
} from '@/lib/whatsapp/webhook-processor'
import { ingestMessengerMessage } from '@/lib/messenger/webhook-processor'

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
// crash): reactions, click-to-WhatsApp referral capture, and Flow
// (nfm_reply) submissions. Swipe-replies, button/list taps, text,
// image/video/document/audio, voice transcription, and image
// description all work (see downloadInboundMedia in
// src/lib/whatsapp/inbound-media.ts for how the latter two reach
// Zernio-bridged media too).
//
// Also handles `message.delivered` / `message.read` / `message.failed`
// (see handleZernioStatusUpdate below) — these carry the delivery-tick
// state the inbox already renders (single check → sent, double check
// → delivered, blue double check → read).
// ============================================================

// Same headroom reasoning as the direct-Meta/Dualhook routes: AI
// auto-reply's debounce wait (~12s) plus the provider's own request
// timeout can add up on top of ordinary processing.
export const maxDuration = 120

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
  if (payload.event === 'message.delivered' || payload.event === 'message.read' || payload.event === 'message.failed') {
    await handleZernioStatusUpdate(payload)
    return
  }

  if (payload.event !== 'message.received') return
  const message = payload.message
  const account = payload.account
  if (!message || !account?.id) return

  // Echoes of our own outbound sends (or a reply typed from Zernio's
  // own native dashboard, outside this CRM). Skipping avoids inserting
  // a duplicate of a message sendMessageToConversation already
  // persisted when it sent via the Zernio bridge.
  if (message.direction !== 'incoming') return

  // Facebook (Messenger) is a separate, narrower pipeline — see
  // processZernioFacebookMessage below for why it doesn't reuse
  // processMessage() the way WhatsApp does. Instagram connect exists
  // in Settings but has no send/receive pipeline yet either — out of
  // scope for this pass.
  if (message.platform === 'facebook') {
    await processZernioFacebookMessage(payload, message, account)
    return
  }
  if (message.platform !== 'whatsapp') return

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

  // Zernio's own conversation id is already known here — passed straight
  // into processMessage so it stamps `conversations.zernio_conversation_id`
  // BEFORE flows/automations/AI auto-reply get a chance to reply (see
  // that function's doc comment on the `zernioConversationId` param for
  // why this used to be stamped too late, and what it broke). Any reply
  // to THIS message — including the very first one in a brand-new
  // conversation — now sends via Zernio's "reply in this conversation"
  // endpoint instead of wrongly trying to cold-start a new one, which
  // only Meta accounts with the unusual "Direct Send" capability can do.
  await processMessage(
    adapted,
    { profile: { name: message.sender?.name || senderPhone }, wa_id: senderPhone },
    zernioAccount.account_id,
    zernioAccount.connected_by_user_id,
    '', // no Meta access token for a Zernio-bridged account
    'zernio',
    payload.conversation?.id ?? null,
  )
}

const ZERNIO_ATTACHMENT_TO_CONTENT_TYPE: Record<string, string> = {
  image: 'image',
  sticker: 'image',
  video: 'video',
  audio: 'audio',
}

/**
 * A Facebook Page connected through Zernio. Deliberately does NOT go
 * through processMessage() the way the WhatsApp branch above does —
 * that pipeline's contact/conversation model is phone-number-keyed
 * throughout (normalizePhone, wa_id, findOrCreateContact-by-phone),
 * which doesn't fit a Messenger PSID. Instead this reuses the exact
 * same ingestion core the direct Graph API Messenger webhook uses
 * (src/lib/messenger/webhook-processor.ts's ingestMessengerMessage),
 * so a Facebook Page behaves identically whether it's bridged through
 * Zernio or connected directly with a Page Access Token — same known
 * gap either way: no automations/Flows/AI auto-reply yet, since those
 * engines currently only know how to reply over WhatsApp (meta-api.ts
 * / zernio-send.ts). See src/lib/messenger/ for the rest of that
 * pipeline's scope notes.
 */
async function processZernioFacebookMessage(
  payload: ZernioWebhookPayload,
  message: NonNullable<ZernioWebhookPayload['message']>,
  account: NonNullable<ZernioWebhookPayload['account']>,
) {
  const psid = message.sender?.id
  if (!psid) {
    console.warn('[webhook/zernio] Facebook message has no resolvable sender psid; skipping')
    return
  }

  const { data: zernioAccount, error: zernioAccountError } = await supabaseAdmin()
    .from('client_zernio_accounts')
    .select('account_id, connected_by_user_id')
    .eq('facebook_account_id', account.id)
    .maybeSingle()

  if (zernioAccountError) {
    console.error('[webhook/zernio] facebook account lookup failed:', zernioAccountError.message)
    return
  }
  if (!zernioAccount) {
    console.warn('[webhook/zernio] no account matches Zernio facebook accountId:', account.id)
    return
  }
  if (!zernioAccount.connected_by_user_id) {
    console.error(
      '[webhook/zernio] facebook account has no connected_by_user_id — reconnect Messenger in Settings to fix:',
      account.id,
    )
    return
  }

  const attachment = message.attachments?.[0]
  const contentType = attachment ? (ZERNIO_ATTACHMENT_TO_CONTENT_TYPE[attachment.type] ?? 'document') : 'text'
  // Same proxy-token trick as WhatsApp's Zernio bridge below
  // (adaptZernioMessage) — Zernio's attachment URL needs the Zernio
  // API key attached server-side, so it's never handed to the browser
  // directly. /api/whatsapp/media/zernio/[token]/route.ts is generic
  // despite its path (decodes + fetches + streams), so it's reused
  // as-is here.
  const mediaUrl = attachment
    ? `/api/whatsapp/media/zernio/${Buffer.from(attachment.url, 'utf8').toString('base64url')}`
    : null

  await ingestMessengerMessage({
    accountId: zernioAccount.account_id,
    configOwnerUserId: zernioAccount.connected_by_user_id,
    psid,
    displayName: message.sender?.name ?? null,
    mid: message.platformMessageId || '',
    contentType,
    contentText: message.text ?? null,
    mediaUrl,
    occurredAt: message.sentAt ? new Date(message.sentAt) : new Date(),
    zernioConversationId: payload.conversation?.id ?? null,
  })
}

const ZERNIO_STATUS_EVENT: Record<string, 'delivered' | 'read' | 'failed'> = {
  'message.delivered': 'delivered',
  'message.read': 'read',
  'message.failed': 'failed',
}

/**
 * Delivery-state updates for a message we already sent — the Zernio
 * counterpart to the direct-Meta path's `handleStatusUpdate` in
 * webhook-processor.ts. Without this, every Zernio-bridged message
 * stayed on "sent" (single check) forever: this route used to drop
 * every event that wasn't `message.received`, so the double-check
 * (delivered) and blue double-check (read) ticks the inbox already
 * knows how to render (see message-bubble.tsx's `StatusIcon`) never
 * had anything to render them FROM.
 *
 * Matches `messages.message_id` against `platformMessageId` via the
 * shared `applyMessageStatusUpdate` (forward-only ladder guard, same
 * "message_id isn't unique, updates 0..N rows" posture as the
 * direct-Meta path — migration 009, Meta ids can repeat across
 * numbers — plus a loud warning when nothing matches at all, which is
 * the one signal worth watching if ticks are reported stuck: it means
 * `sendViaZernio`'s stored `message_id` and this webhook's
 * `platformMessageId` disagree for that message).
 */
async function handleZernioStatusUpdate(payload: ZernioWebhookPayload) {
  const status = ZERNIO_STATUS_EVENT[payload.event]
  const platformMessageId = payload.message?.platformMessageId
  if (!status || !platformMessageId) return

  await applyMessageStatusUpdate(platformMessageId, status, '[webhook/zernio]')
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
