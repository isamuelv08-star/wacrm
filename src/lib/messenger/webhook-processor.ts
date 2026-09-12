import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { decrypt, encrypt, isLegacyFormat } from '@/lib/whatsapp/encryption'
import { getUserProfile } from '@/lib/messenger/graph-api'
import { isUniqueViolation } from '@/lib/contacts/dedupe'
import { reopenClosedConversation } from '@/lib/conversations/reopen'
import { pickRoundRobinAgent } from '@/lib/assignment/round-robin'
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver'
import { notifyNewMessage } from '@/lib/notifications/new-message-alert'
import { ensureLeadDeal } from '@/lib/whatsapp/webhook-processor'
import { dispatchInboundToAiReply } from '@/lib/ai/auto-reply'
import { classifyLeadIfNeeded } from '@/lib/ai/lead-classify'

// ============================================================
// Messenger inbound-webhook processing pipeline — the counterpart to
// src/lib/whatsapp/webhook-processor.ts, reusing the same
// contacts/conversations/messages tables (conversations.platform =
// 'messenger', contacts keyed by messenger_psid instead of phone).
//
// Deliberately narrower than the WhatsApp pipeline: it creates
// contacts/conversations/messages, updates delivery/read receipts,
// keeps the pipeline (deals) and popup notifications in sync, re-opens
// a closed thread on a new reply, and — since migration 082 — dispatches
// AI auto-reply + lead scoring, gated on the account having opted
// 'messenger' into `ai_configs.autoreply_channels` (see
// src/lib/ai/auto-reply.ts's eligibility gates and
// src/lib/flows/meta-send.ts's platform-aware resolveSendContext,
// which is how the bot's reply actually reaches Messenger). It does
// NOT run automations, Flows, or transcription/vision — those engines
// are wired to the WhatsApp-only inbound shape throughout
// (webhook-processor.ts's WhatsAppMessage type, keyword/interactive
// triggers, etc.) and generalizing them is a separate, larger piece of
// work than auto-reply's send-only extension.
// ============================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null
export function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _adminClient
}

export interface MessengerAttachment {
  type: 'image' | 'video' | 'audio' | 'file' | 'template' | 'fallback'
  payload?: { url?: string }
}

export interface MessengerMessagingEvent {
  sender: { id: string }
  recipient: { id: string }
  timestamp: number
  message?: {
    mid: string
    text?: string
    attachments?: MessengerAttachment[]
    // Present when this event is an echo of OUR OWN outbound send
    // (only sent back to us if the `messages` subscribed field is on
    // and the send didn't come from this same webhook round-trip) —
    // skipped entirely, see processEntry below.
    is_echo?: boolean
  }
  delivery?: { mids?: string[]; watermark: number }
  read?: { watermark: number }
  postback?: { title?: string; payload?: string }
}

export interface MessengerWebhookEntry {
  id: string // Page ID
  time: number
  messaging?: MessengerMessagingEvent[]
}

// ============================================================
// GET verification. Meta's `hub.verify_token` challenge is checked
// against every connected account's messenger_config.verify_token,
// same fan-out pattern the WhatsApp route uses for whatsapp_config.
// ============================================================
export async function handleMessengerWebhookVerificationGET(
  request: Request,
): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url)
    const mode = searchParams.get('hub.mode')
    const challenge = searchParams.get('hub.challenge')
    const verifyToken = searchParams.get('hub.verify_token')

    if (mode !== 'subscribe' || !challenge || !verifyToken) {
      return NextResponse.json({ error: 'Missing verification parameters' }, { status: 400 })
    }

    const { data: configs, error: configError } = await supabaseAdmin()
      .from('messenger_config')
      .select('id, verify_token')

    if (configError || !configs) {
      console.error('[messenger webhook] Error fetching configs for verification:', configError)
      return NextResponse.json({ error: 'Verification failed' }, { status: 403 })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let matchedConfig: any = null
    for (const config of configs) {
      if (!config.verify_token) continue
      try {
        if (decrypt(config.verify_token) === verifyToken) {
          matchedConfig = config
          break
        }
      } catch {
        // Malformed / wrong-key token row — skip and keep checking.
      }
    }

    if (matchedConfig) {
      if (isLegacyFormat(matchedConfig.verify_token)) {
        void supabaseAdmin()
          .from('messenger_config')
          .update({ verify_token: encrypt(verifyToken) })
          .eq('id', matchedConfig.id)
          .then(({ error }: { error: unknown }) => {
            if (error) {
              console.warn(
                '[messenger webhook] verify_token GCM upgrade failed:',
                (error as { message?: string })?.message ?? error,
              )
            }
          })
      }
      return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } })
    }

    return NextResponse.json({ error: 'Verification token mismatch' }, { status: 403 })
  } catch (error) {
    console.error('[messenger webhook] Error in GET verification:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// ============================================================
// POST payload processing.
// ============================================================
export async function processMessengerWebhookPayload(body: {
  object?: string
  entry?: MessengerWebhookEntry[]
}) {
  if (body.object !== 'page' || !body.entry) return

  for (const entry of body.entry) {
    if (!entry.messaging) continue

    const { data: config, error: configError } = await supabaseAdmin()
      .from('messenger_config')
      .select('*')
      .eq('page_id', entry.id)
      .maybeSingle()

    if (configError) {
      console.error('[messenger webhook] Error fetching messenger_config for page:', entry.id, configError)
      continue
    }
    if (!config) {
      console.error('[messenger webhook] No config found for page_id:', entry.id)
      continue
    }

    const pageAccessToken = decrypt(config.page_access_token)

    for (const event of entry.messaging) {
      try {
        if (event.delivery) {
          await handleDeliveryReceipt(config.account_id, event.sender.id, event.delivery)
          continue
        }
        if (event.read) {
          await handleReadReceipt(config.account_id, event.sender.id, event.read)
          continue
        }
        if (event.message && !event.message.is_echo) {
          await processInboundMessage(event, config.account_id, config.user_id, pageAccessToken)
        }
        // postback / echo events: no-op for this first cut.
      } catch (err) {
        console.error('[messenger webhook] Error processing messaging event:', err)
      }
    }
  }
}

/**
 * `displayName` is resolved by the CALLER, not here — the two inbound
 * transports get it very differently. The direct Graph API path
 * (processInboundMessage below) has no name in the webhook payload at
 * all and must ask the Graph API for one (getUserProfile); the
 * Zernio-bridged path already gets a resolved `sender.name` on the
 * payload itself, same as Zernio hands WhatsApp contact names, so it
 * has nothing further to look up.
 */
async function findOrCreateContactByPsid(
  accountId: string,
  configOwnerUserId: string,
  psid: string,
  displayName: string | null,
) {
  const { data: existing, error: findError } = await supabaseAdmin()
    .from('contacts')
    .select('*')
    .eq('account_id', accountId)
    .eq('messenger_psid', psid)
    .maybeSingle()

  if (findError) {
    console.error('[messenger webhook] Error finding contact by psid:', findError)
    return null
  }
  if (existing) return { contact: existing, wasCreated: false }

  const placeholder = `Messenger:${psid}`

  const { data: created, error: createError } = await supabaseAdmin()
    .from('contacts')
    .insert({
      account_id: accountId,
      user_id: configOwnerUserId,
      // `phone` stays NOT NULL account-wide (see migration 080's
      // comment) — a Messenger-only contact gets this placeholder
      // instead of a real number. It is never shown as a phone in the
      // inbox (see getContactSubtitle in src/lib/inbox/platform.ts),
      // only used where the schema still requires a string.
      phone: placeholder,
      messenger_psid: psid,
      name: displayName || placeholder,
    })
    .select()
    .single()

  if (createError) {
    if (isUniqueViolation(createError)) {
      const { data: raced } = await supabaseAdmin()
        .from('contacts')
        .select('*')
        .eq('account_id', accountId)
        .eq('messenger_psid', psid)
        .maybeSingle()
      if (raced) return { contact: raced, wasCreated: false }
    }
    console.error('[messenger webhook] Error creating contact:', createError)
    return null
  }

  return { contact: created, wasCreated: true }
}

async function findOrCreateConversation(
  accountId: string,
  configOwnerUserId: string,
  contactId: string,
) {
  const { data: existingRows, error: findError } = await supabaseAdmin()
    .from('conversations')
    .select('*')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: true })
    .limit(1)

  if (findError) {
    console.error('[messenger webhook] Error finding conversation:', findError)
    return null
  }
  if (existingRows && existingRows.length > 0) {
    return { conversation: existingRows[0], created: false }
  }

  const assignedAgentId = await pickRoundRobinAgent(supabaseAdmin(), accountId)

  const { data: newConv, error: createError } = await supabaseAdmin()
    .from('conversations')
    .insert({
      account_id: accountId,
      user_id: configOwnerUserId,
      contact_id: contactId,
      assigned_agent_id: assignedAgentId,
      platform: 'messenger',
    })
    .select()
    .single()

  if (createError) {
    if (isUniqueViolation(createError)) {
      const { data: raced } = await supabaseAdmin()
        .from('conversations')
        .select('*')
        .eq('account_id', accountId)
        .eq('contact_id', contactId)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()
      if (raced) return { conversation: raced, created: false }
    }
    console.error('[messenger webhook] Error creating conversation:', createError)
    return null
  }

  return { conversation: newConv, created: true }
}

const ATTACHMENT_TO_CONTENT_TYPE: Record<string, string> = {
  image: 'image',
  video: 'video',
  audio: 'audio',
  file: 'document',
  fallback: 'text',
  template: 'text',
}

/**
 * Shared inbound-ingestion core: given an already-normalized Messenger
 * message (psid + text/attachment + a platform message id), does
 * everything transport-agnostic — find/create contact + conversation,
 * dedupe, pipeline lead creation, insert the message row, bump the
 * conversation preview, re-open if closed, and notify.
 *
 * Both inbound transports call this: the direct Graph API webhook
 * (processInboundMessage below, after its own Graph-API-specific
 * parsing) AND a Facebook Page connected through Zernio
 * (src/app/api/whatsapp/webhook/zernio/route.ts's processZernioEvent,
 * after ITS Zernio-specific parsing) — so a Facebook Page's inbound
 * messages behave identically regardless of which one actually
 * delivered them.
 */
export async function ingestMessengerMessage(args: {
  accountId: string
  configOwnerUserId: string
  psid: string
  displayName: string | null
  mid: string
  contentType: string
  contentText: string | null
  mediaUrl: string | null
  occurredAt: Date
  /**
   * Zernio's own conversation id for this thread, when the message
   * arrived via the Zernio bridge (null for the direct Graph API
   * path). Stamped onto `conversations.zernio_conversation_id` BEFORE
   * this function returns — same "stamp early" reasoning as the
   * WhatsApp pipeline's processMessage: an outbound reply sent right
   * after this inbound message needs that id to reply within the
   * existing Zernio conversation instead of trying (and, on Facebook,
   * failing — there is no proactive-send equivalent) to open a new
   * one.
   */
  zernioConversationId?: string | null
}): Promise<void> {
  const {
    accountId,
    configOwnerUserId,
    psid,
    displayName,
    mid,
    contentType,
    contentText,
    mediaUrl,
    occurredAt,
    zernioConversationId,
  } = args

  const contactOutcome = await findOrCreateContactByPsid(accountId, configOwnerUserId, psid, displayName)
  if (!contactOutcome) return
  const contactRecord = contactOutcome.contact

  const convResult = await findOrCreateConversation(accountId, configOwnerUserId, contactRecord.id)
  if (!convResult) return
  const conversation = convResult.conversation

  if (zernioConversationId && conversation.zernio_conversation_id !== zernioConversationId) {
    const { error: stampErr } = await supabaseAdmin()
      .from('conversations')
      .update({ zernio_conversation_id: zernioConversationId })
      .eq('id', conversation.id)
    if (stampErr) {
      console.error('[messenger webhook] failed to stamp zernio_conversation_id:', stampErr.message)
    } else {
      conversation.zernio_conversation_id = zernioConversationId
    }
  }

  // Idempotency guard against redelivery — same approach as the
  // WhatsApp pipeline (migration 062's unique index also covers this
  // insert, since it's on (conversation_id, message_id) generally).
  const { data: existingDelivery } = await supabaseAdmin()
    .from('messages')
    .select('id')
    .eq('conversation_id', conversation.id)
    .eq('message_id', mid)
    .maybeSingle()
  if (existingDelivery) {
    console.warn('[messenger webhook] duplicate delivery ignored:', mid)
    return
  }

  if (convResult.created) {
    await dispatchWebhookEvent(supabaseAdmin(), accountId, 'conversation.created', {
      conversation_id: conversation.id,
      contact_id: contactRecord.id,
    })
  }

  await ensureLeadDeal(accountId, configOwnerUserId, contactRecord, conversation.id)

  const { data: insertedMessage, error: msgError } = await supabaseAdmin()
    .from('messages')
    .insert({
      conversation_id: conversation.id,
      sender_type: 'customer',
      content_type: contentType,
      content_text: contentText,
      media_url: mediaUrl,
      message_id: mid,
      status: 'delivered',
      created_at: occurredAt.toISOString(),
    })
    .select('id')
    .single()

  if (msgError || !insertedMessage) {
    if (isUniqueViolation(msgError)) {
      console.warn('[messenger webhook] duplicate delivery caught on insert:', mid)
      return
    }
    console.error('[messenger webhook] Error inserting message:', msgError)
    return
  }

  const { error: convError } = await supabaseAdmin()
    .from('conversations')
    .update({
      last_message_text: contentText || `[${contentType}]`,
      last_message_at: new Date().toISOString(),
      unread_count: (conversation.unread_count || 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversation.id)
  if (convError) {
    console.error('[messenger webhook] Error updating conversation:', convError)
  }

  await reopenClosedConversation(supabaseAdmin(), conversation)

  await notifyNewMessage(supabaseAdmin(), {
    accountId,
    conversationId: conversation.id,
    contactId: contactRecord.id,
    contactName: contactRecord.name ?? null,
    contactPhone: contactRecord.phone,
    assignedAgentId: conversation.assigned_agent_id ?? null,
    preview: contentText || `[${contentType}]`,
  })

  // AI auto-reply + lead scoring — same "something to react to" gate
  // the WhatsApp pipeline uses (text, or any attachment at all; there's
  // no Messenger-side vision/transcription pass narrowing this further
  // the way WhatsApp's hasImageDescription/audio checks do). Both own
  // their full eligibility gates (including the `messenger` channel
  // opt-in, migration 082) and their own try/catch — never throws.
  if (contentText?.trim() || contentType !== 'text') {
    await dispatchInboundToAiReply({
      accountId,
      conversationId: conversation.id,
      contactId: contactRecord.id,
      configOwnerUserId,
      platform: 'messenger',
    })

    await classifyLeadIfNeeded({
      accountId,
      conversationId: conversation.id,
      contactId: contactRecord.id,
      configOwnerUserId,
    })
  }
}

/**
 * Direct Graph API adapter — resolves the Graph-API-specific bits
 * (attachment shape, no display name on the payload at all) and hands
 * off to the shared `ingestMessengerMessage` core above.
 */
async function processInboundMessage(
  event: MessengerMessagingEvent,
  accountId: string,
  configOwnerUserId: string,
  pageAccessToken: string,
) {
  const message = event.message!
  const psid = event.sender.id

  // Messenger's webhook payload carries no display name at all —
  // best-effort Graph API lookup, falls back to a PSID placeholder
  // inside findOrCreateContactByPsid when this comes back null.
  const displayName = await getUserProfile({ psid, pageAccessToken })

  const attachment = message.attachments?.[0]
  const contentType = attachment ? (ATTACHMENT_TO_CONTENT_TYPE[attachment.type] ?? 'text') : 'text'
  const mediaUrl = attachment?.payload?.url ?? null

  await ingestMessengerMessage({
    accountId,
    configOwnerUserId,
    psid,
    displayName,
    mid: message.mid,
    contentType,
    contentText: message.text ?? null,
    mediaUrl,
    occurredAt: new Date(event.timestamp),
  })
}

/**
 * A `delivery` event's `watermark` is "every message I sent with a
 * timestamp at or before this has been delivered" — not a single
 * message id. Advances every one of OUR messages in this conversation
 * that's still behind 'delivered' on the status ladder, same ladder
 * WhatsApp's status webhook enforces (never regress read → delivered).
 */
async function handleDeliveryReceipt(
  accountId: string,
  psid: string,
  delivery: { watermark: number },
) {
  const conversationId = await resolveConversationIdForPsid(accountId, psid)
  if (!conversationId) return

  const { error } = await supabaseAdmin()
    .from('messages')
    .update({ status: 'delivered' })
    .eq('conversation_id', conversationId)
    .eq('sender_type', 'agent')
    .in('status', ['sending', 'sent'])
    .lte('created_at', new Date(delivery.watermark).toISOString())

  if (error) {
    console.error('[messenger webhook] delivery receipt update failed:', error.message)
  }
}

async function handleReadReceipt(
  accountId: string,
  psid: string,
  read: { watermark: number },
) {
  const conversationId = await resolveConversationIdForPsid(accountId, psid)
  if (!conversationId) return

  const { error } = await supabaseAdmin()
    .from('messages')
    .update({ status: 'read' })
    .eq('conversation_id', conversationId)
    .eq('sender_type', 'agent')
    .in('status', ['sending', 'sent', 'delivered'])
    .lte('created_at', new Date(read.watermark).toISOString())

  if (error) {
    console.error('[messenger webhook] read receipt update failed:', error.message)
  }
}

async function resolveConversationIdForPsid(accountId: string, psid: string): Promise<string | null> {
  const { data: contact } = await supabaseAdmin()
    .from('contacts')
    .select('id')
    .eq('account_id', accountId)
    .eq('messenger_psid', psid)
    .maybeSingle()
  if (!contact) return null

  const { data: conversation } = await supabaseAdmin()
    .from('conversations')
    .select('id')
    .eq('account_id', accountId)
    .eq('contact_id', contact.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  return conversation?.id ?? null
}
