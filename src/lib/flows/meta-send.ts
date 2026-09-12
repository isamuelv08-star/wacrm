import {
  sendInteractiveButtons,
  sendInteractiveList,
  sendMediaMessage,
  sendTextMessage,
  type InteractiveButton,
  type InteractiveListSection,
  type MediaKind,
} from '@/lib/whatsapp/meta-api'
import type { InteractiveMessagePayload } from '@/lib/whatsapp/interactive'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from '@/lib/whatsapp/phone-utils'
import { resolveZernioSocialAccountId, sendViaZernio } from '@/lib/whatsapp/zernio-send'
import {
  sendTextMessage as sendMessengerText,
  sendAttachmentMessage as sendMessengerAttachment,
  type MessengerAttachmentKind,
} from '@/lib/messenger/graph-api'
import { resolveZernioFacebookAccountId, sendViaZernioMessenger } from '@/lib/messenger/zernio-send'
import { supabaseAdmin } from './admin-client'

/**
 * Send via the Zernio bridge and persist, for a Zernio-connected
 * account — shared by engineSendText / engineSendMedia /
 * sendInteractiveViaMeta below so none of the three has to duplicate
 * the "load conversation's zernio_conversation_id, send, persist it
 * back if new" dance.
 */
async function sendViaZernioAndPersist(
  db: ReturnType<typeof supabaseAdmin>,
  zernioSocialAccountId: string,
  args: {
    conversationId: string
    recipientPhone: string
    messageType: 'text' | 'image' | 'video' | 'document' | 'audio' | 'template' | 'interactive'
    contentText?: string | null
    mediaUrl?: string | null
    filename?: string | null
    interactivePayload?: InteractiveMessagePayload | null
  },
): Promise<string> {
  const { data: conv } = await db
    .from('conversations')
    .select('zernio_conversation_id')
    .eq('id', args.conversationId)
    .maybeSingle()

  const result = await sendViaZernio(
    zernioSocialAccountId,
    (conv?.zernio_conversation_id as string | null) ?? null,
    args.recipientPhone,
    {
      messageType: args.messageType,
      contentText: args.contentText,
      mediaUrl: args.mediaUrl,
      filename: args.filename,
    },
    undefined,
    args.interactivePayload,
  )

  if (result.zernioConversationId) {
    await db
      .from('conversations')
      .update({ zernio_conversation_id: result.zernioConversationId })
      .eq('id', args.conversationId)
  }

  return result.waMessageId
}

// ------------------------------------------------------------
// Flows-side Meta sender (interactive variants).
//
// Mirrors src/lib/automations/meta-send.ts (engineSendText /
// engineSendTemplate) but emits interactive button + list messages.
// Kept separate from the automations file so the two engines don't
// fight over each other's shape — once both stabilize, the
// phone-variant retry + DB persistence are obvious extraction
// candidates into a shared base.
//
// PR #1 ships this in isolation: callers don't exist yet. PR #2
// brings the flow runner online and wires it up. Shipping it now
// keeps the foundation PR self-contained and unit-testable.
// ------------------------------------------------------------

interface SendTextEngineArgs {
  /** Account-level tenancy key. Drives contact + whatsapp_config
   *  lookups so a flow authored by user A still sends through the
   *  WhatsApp number user B saved on the same account. */
  accountId: string
  /** Original author of the flow — used for INSERT audit columns
   *  and for resolving the agent's identity in logs. Not consulted
   *  for tenancy. */
  userId: string
  conversationId: string
  contactId: string
  text: string
  /** Marks the persisted message row `ai_generated = true` so the inbox
   *  badges it as an AI reply. Only the auto-reply bot sets this;
   *  deterministic Flow/automation sends leave it false. */
  aiGenerated?: boolean
  /** Skip the contact/Zernio/whatsapp_config resolution below and use
   *  this instead — see `resolveSendContext`'s doc comment for why a
   *  multi-part reply wants to pass the same one to every part. */
  resolved?: ResolvedSendContext
}

export interface ResolvedSendContext {
  platform: 'whatsapp' | 'messenger'
  contactRowId: string
  // WhatsApp branch (platform === 'whatsapp')
  sanitizedPhone?: string
  zernioSocialAccountId?: string | null
  /** Null when Zernio-bridged (zernioSocialAccountId is set instead). */
  whatsappConfig?: { phone_number_id: string; send_api_base: string | null } | null
  /** Decrypted access token. Null when Zernio-bridged. */
  accessToken?: string | null
  // Messenger branch (platform === 'messenger')
  messengerPsid?: string
  messengerZernioAccountId?: string | null
  /** Decrypted Page Access Token. Null when Zernio-bridged instead. */
  messengerPageAccessToken?: string | null
}

/**
 * Resolve everything about "how do we reach this contact" once: which
 * channel the conversation is on, and — per channel — whether the
 * account is Zernio-bridged or connected directly, plus whatever
 * credentials that path needs.
 *
 * `engineSendText` used to redo these 2-3 DB reads (+ a decrypt) on
 * every single call, which is fine for one-off Flow sends but wasteful
 * for the AI auto-reply bot's multi-part replies (up to
 * MAX_REPLY_PARTS messages to the SAME contact in the SAME turn) —
 * resolve once here, then pass the result into every `engineSendText`
 * call via its `resolved` param.
 */
export async function resolveSendContext(
  db: ReturnType<typeof supabaseAdmin>,
  accountId: string,
  contactId: string,
  conversationId: string,
): Promise<ResolvedSendContext> {
  const { data: conv } = await db
    .from('conversations')
    .select('platform')
    .eq('id', conversationId)
    .maybeSingle()
  const platform: 'whatsapp' | 'messenger' = conv?.platform === 'messenger' ? 'messenger' : 'whatsapp'

  if (platform === 'messenger') {
    const { data: contact, error: contactErr } = await db
      .from('contacts')
      .select('id, messenger_psid')
      .eq('id', contactId)
      .eq('account_id', accountId)
      .maybeSingle()
    if (contactErr || !contact?.messenger_psid) {
      throw new Error('contact has no Messenger PSID on file')
    }

    const zernioFacebookAccountId = await resolveZernioFacebookAccountId(db, accountId)
    if (zernioFacebookAccountId) {
      return {
        platform: 'messenger',
        contactRowId: contact.id,
        messengerPsid: contact.messenger_psid,
        messengerZernioAccountId: zernioFacebookAccountId,
        messengerPageAccessToken: null,
      }
    }

    const { data: config, error: configErr } = await db
      .from('messenger_config')
      .select('page_access_token')
      .eq('account_id', accountId)
      .maybeSingle()
    if (configErr || !config) {
      throw new Error('Messenger not configured for this account')
    }

    return {
      platform: 'messenger',
      contactRowId: contact.id,
      messengerPsid: contact.messenger_psid,
      messengerZernioAccountId: null,
      messengerPageAccessToken: decrypt(config.page_access_token),
    }
  }

  const { data: contact, error: contactErr } = await db
    .from('contacts')
    .select('id, phone')
    .eq('id', contactId)
    .eq('account_id', accountId)
    .maybeSingle()
  if (contactErr || !contact?.phone) {
    throw new Error('contact not found for this account')
  }

  const sanitized = sanitizePhoneForMeta(contact.phone)
  if (!isValidE164(sanitized)) {
    throw new Error(`contact phone invalid: ${contact.phone}`)
  }

  const zernioSocialAccountId = await resolveZernioSocialAccountId(db, accountId)
  if (zernioSocialAccountId) {
    return {
      platform: 'whatsapp',
      sanitizedPhone: sanitized,
      contactRowId: contact.id,
      zernioSocialAccountId,
      whatsappConfig: null,
      accessToken: null,
    }
  }

  const { data: config, error: configErr } = await db
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', accountId)
    .single()
  if (configErr || !config) {
    throw new Error('WhatsApp not configured for this account')
  }

  return {
    platform: 'whatsapp',
    sanitizedPhone: sanitized,
    contactRowId: contact.id,
    zernioSocialAccountId: null,
    whatsappConfig: { phone_number_id: config.phone_number_id, send_api_base: config.send_api_base ?? null },
    accessToken: decrypt(config.access_token),
  }
}

/**
 * Send a plain-text WhatsApp message from the Flows engine.
 *
 * Used by the runner's `send_message` and `collect_input` nodes —
 * both prompt the customer with text and either auto-advance (the
 * send_message case) or suspend awaiting a text reply (collect_input).
 *
 * Wraps the same phone-variant retry + DB persistence pattern as the
 * interactive senders; the duplication will be DRY'd into a shared
 * `engineSendBase` once the v2 features (templates with variables,
 * media sends) settle.
 */
export async function engineSendText(
  args: SendTextEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  const db = supabaseAdmin()

  const ctx =
    args.resolved ?? (await resolveSendContext(db, args.accountId, args.contactId, args.conversationId))

  if (ctx.platform === 'messenger') {
    let messageId: string
    if (ctx.messengerZernioAccountId) {
      const { data: conv } = await db
        .from('conversations')
        .select('zernio_conversation_id')
        .eq('id', args.conversationId)
        .maybeSingle()
      const result = await sendViaZernioMessenger(
        ctx.messengerZernioAccountId,
        (conv?.zernio_conversation_id as string | null) ?? null,
        { messageType: 'text', contentText: args.text },
      )
      messageId = result.messageId
    } else {
      const result = await sendMessengerText({
        pageAccessToken: ctx.messengerPageAccessToken!,
        recipientPsid: ctx.messengerPsid!,
        text: args.text,
      })
      messageId = result.messageId
    }

    const { error: msgErr } = await db.from('messages').insert({
      conversation_id: args.conversationId,
      sender_type: 'bot',
      content_type: 'text',
      content_text: args.text,
      message_id: messageId,
      status: 'sent',
      ai_generated: args.aiGenerated ?? false,
    })
    if (msgErr) {
      throw new Error(`sent to Messenger but DB insert failed: ${msgErr.message}`)
    }

    await db
      .from('conversations')
      .update({
        last_message_text: args.text,
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', args.conversationId)

    return { whatsapp_message_id: messageId }
  }

  const sanitized = ctx.sanitizedPhone!

  let waMessageId: string
  if (ctx.zernioSocialAccountId) {
    waMessageId = await sendViaZernioAndPersist(db, ctx.zernioSocialAccountId, {
      conversationId: args.conversationId,
      recipientPhone: sanitized,
      messageType: 'text',
      contentText: args.text,
    })
  } else {
    // Only unset when Zernio-bridged (the branch above), which we're
    // not in here — see ResolvedSendContext's doc comment.
    const config = ctx.whatsappConfig!
    const accessToken = ctx.accessToken!

    const attempt = async (phone: string): Promise<string> => {
      const r = await sendTextMessage({
        phoneNumberId: config.phone_number_id,
        accessToken,
        to: phone,
        text: args.text,
        apiBase: config.send_api_base ?? undefined,
      })
      return r.messageId
    }

    const variants = phoneVariants(sanitized)
    let workingPhone = sanitized
    let sentId = ''
    let lastError: unknown = null
    for (const v of variants) {
      try {
        sentId = await attempt(v)
        workingPhone = v
        lastError = null
        break
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (!isRecipientNotAllowedError(msg)) throw err
        lastError = err
      }
    }
    if (lastError) throw lastError
    waMessageId = sentId

    if (workingPhone !== sanitized) {
      await db.from('contacts').update({ phone: workingPhone }).eq('id', ctx.contactRowId)
    }
  }

  const { error: msgErr } = await db.from('messages').insert({
    conversation_id: args.conversationId,
    sender_type: 'bot',
    content_type: 'text',
    content_text: args.text,
    message_id: waMessageId,
    status: 'sent',
    ai_generated: args.aiGenerated ?? false,
  })
  if (msgErr) {
    throw new Error(`sent to Meta but DB insert failed: ${msgErr.message}`)
  }

  await db
    .from('conversations')
    .update({
      last_message_text: args.text,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', args.conversationId)

  return { whatsapp_message_id: waMessageId }
}

interface SendMediaEngineArgs {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  kind: MediaKind
  /** Public URL Meta fetches at send time. */
  link: string
  caption?: string
  /** Document-only; ignored by Meta for image/video. */
  filename?: string
  /** Marks the persisted message row `ai_generated = true` so the inbox
   *  badges it as an AI reply — mirrors `engineSendText`'s param. Only
   *  the auto-reply bot's media-sending sentinel sets this (see
   *  src/lib/ai/media-actions.ts); deterministic Flow `send_media` nodes
   *  leave it false. */
  aiGenerated?: boolean
}

/**
 * Send an image / video / document from the Flows engine.
 *
 * Used by the runner's `send_media` node. Auto-advances after the
 * send lands (same suspend semantics as send_message). Same
 * phone-variant retry + DB persistence as the text/interactive
 * senders; persists the outgoing message with `content_type` matching
 * the media kind so the inbox renders the right preview.
 */
export async function engineSendMedia(
  args: SendMediaEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  const db = supabaseAdmin()

  const ctx = await resolveSendContext(db, args.accountId, args.contactId, args.conversationId)

  if (ctx.platform === 'messenger') {
    const kind = args.kind === 'document' ? 'file' : args.kind
    let messageId: string
    if (ctx.messengerZernioAccountId) {
      const { data: conv } = await db
        .from('conversations')
        .select('zernio_conversation_id')
        .eq('id', args.conversationId)
        .maybeSingle()
      const result = await sendViaZernioMessenger(
        ctx.messengerZernioAccountId,
        (conv?.zernio_conversation_id as string | null) ?? null,
        { messageType: args.kind, contentText: args.caption, mediaUrl: args.link, filename: args.filename },
      )
      messageId = result.messageId
    } else {
      const result = await sendMessengerAttachment({
        pageAccessToken: ctx.messengerPageAccessToken!,
        recipientPsid: ctx.messengerPsid!,
        kind: kind as MessengerAttachmentKind,
        url: args.link,
      })
      messageId = result.messageId
    }

    const preview = args.caption?.trim() || `[${args.kind}]`
    const { error: msgErr } = await db.from('messages').insert({
      conversation_id: args.conversationId,
      sender_type: 'bot',
      content_type: args.kind,
      content_text: args.caption ?? null,
      message_id: messageId,
      status: 'sent',
      ai_generated: args.aiGenerated ?? false,
    })
    if (msgErr) {
      throw new Error(`sent to Messenger but DB insert failed: ${msgErr.message}`)
    }

    await db
      .from('conversations')
      .update({
        last_message_text: preview,
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', args.conversationId)

    return { whatsapp_message_id: messageId }
  }

  const sanitized = ctx.sanitizedPhone!
  const contact = { id: ctx.contactRowId }
  const zernioSocialAccountId = ctx.zernioSocialAccountId ?? null

  let waMessageId: string
  if (zernioSocialAccountId) {
    waMessageId = await sendViaZernioAndPersist(db, zernioSocialAccountId, {
      conversationId: args.conversationId,
      recipientPhone: sanitized,
      messageType: args.kind,
      contentText: args.caption,
      mediaUrl: args.link,
      filename: args.filename,
    })
  } else {
    const { data: config, error: configErr } = await db
      .from('whatsapp_config')
      .select('*')
      .eq('account_id', args.accountId)
      .single()
    if (configErr || !config) {
      throw new Error('WhatsApp not configured for this account')
    }

    const accessToken = decrypt(config.access_token)

    const attempt = async (phone: string): Promise<string> => {
      const r = await sendMediaMessage({
        phoneNumberId: config.phone_number_id,
        accessToken,
        to: phone,
        kind: args.kind,
        link: args.link,
        caption: args.caption,
        filename: args.filename,
        apiBase: config.send_api_base ?? undefined,
      })
      return r.messageId
    }

    const variants = phoneVariants(sanitized)
    let workingPhone = sanitized
    let sentId = ''
    let lastError: unknown = null
    for (const v of variants) {
      try {
        sentId = await attempt(v)
        workingPhone = v
        lastError = null
        break
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (!isRecipientNotAllowedError(msg)) throw err
        lastError = err
      }
    }
    if (lastError) throw lastError
    waMessageId = sentId

    if (workingPhone !== sanitized) {
      await db.from('contacts').update({ phone: workingPhone }).eq('id', contact.id)
    }
  }

  // content_type='image'|'video'|'document' — these are already in the
  // messages_content_type_check constraint (migration 001 + 010).
  // content_text carries the caption (or empty) so the conversation
  // list preview shows something meaningful when the user glances at it.
  const preview = args.caption?.trim() || `[${args.kind}]`
  const { error: msgErr } = await db.from('messages').insert({
    conversation_id: args.conversationId,
    sender_type: 'bot',
    content_type: args.kind,
    content_text: args.caption ?? null,
    message_id: waMessageId,
    status: 'sent',
    ai_generated: args.aiGenerated ?? false,
  })
  if (msgErr) {
    throw new Error(`sent to Meta but DB insert failed: ${msgErr.message}`)
  }

  await db
    .from('conversations')
    .update({
      last_message_text: preview,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', args.conversationId)

  return { whatsapp_message_id: waMessageId }
}

interface SendInteractiveButtonsEngineArgs {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  bodyText: string
  buttons: InteractiveButton[]
  headerText?: string
  footerText?: string
}

interface SendInteractiveListEngineArgs {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  bodyText: string
  buttonLabel: string
  sections: InteractiveListSection[]
  headerText?: string
  footerText?: string
}

/**
 * Send an interactive-button WhatsApp message from the Flows engine.
 *
 * Persists the outgoing message to `messages` with
 * `content_type='interactive'` and `sender_type='bot'` so the inbox
 * surfaces it with the "Button reply" affordance and the conversation
 * thread reflects the bot's prompt.
 *
 * Returns the Meta message id so the caller (engine) can stash it on
 * the `flow_runs.last_prompt_message_id` field for later reference.
 */
export async function engineSendInteractiveButtons(
  args: SendInteractiveButtonsEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  return sendInteractiveViaMeta({ ...args, kind: 'buttons' })
}

/**
 * Send an interactive-list WhatsApp message from the Flows engine.
 * Used when the flow needs more than 3 options (Meta's button cap).
 */
export async function engineSendInteractiveList(
  args: SendInteractiveListEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  return sendInteractiveViaMeta({ ...args, kind: 'list' })
}

type SendInput =
  | (SendInteractiveButtonsEngineArgs & { kind: 'buttons' })
  | (SendInteractiveListEngineArgs & { kind: 'list' })

async function sendInteractiveViaMeta(
  input: SendInput,
): Promise<{ whatsapp_message_id: string }> {
  const db = supabaseAdmin()

  // Scope the contact + whatsapp_config lookups by account_id —
  // same defense-in-depth rationale as automations/meta-send.ts.
  // Migration 017 moved both tables to account-scoped tenancy.
  const { data: contact, error: contactErr } = await db
    .from('contacts')
    .select('id, phone')
    .eq('id', input.contactId)
    .eq('account_id', input.accountId)
    .maybeSingle()
  if (contactErr || !contact?.phone) {
    throw new Error('contact not found for this account')
  }

  const sanitized = sanitizePhoneForMeta(contact.phone)
  if (!isValidE164(sanitized)) {
    throw new Error(`contact phone invalid: ${contact.phone}`)
  }

  const interactivePayload: InteractiveMessagePayload =
    input.kind === 'buttons'
      ? {
          kind: 'buttons',
          body: input.bodyText,
          header: input.headerText,
          footer: input.footerText,
          buttons: input.buttons,
        }
      : {
          kind: 'list',
          body: input.bodyText,
          header: input.headerText,
          footer: input.footerText,
          button_label: input.buttonLabel,
          sections: input.sections,
        }

  const zernioSocialAccountId = await resolveZernioSocialAccountId(db, input.accountId)

  let waMessageId: string
  if (zernioSocialAccountId) {
    waMessageId = await sendViaZernioAndPersist(db, zernioSocialAccountId, {
      conversationId: input.conversationId,
      recipientPhone: sanitized,
      messageType: 'interactive',
      interactivePayload,
    })
  } else {
    const { data: config, error: configErr } = await db
      .from('whatsapp_config')
      .select('*')
      .eq('account_id', input.accountId)
      .single()
    if (configErr || !config) {
      throw new Error('WhatsApp not configured for this account')
    }

    const accessToken = decrypt(config.access_token)

    const attempt = async (phone: string): Promise<string> => {
      if (input.kind === 'buttons') {
        const r = await sendInteractiveButtons({
          phoneNumberId: config.phone_number_id,
          accessToken,
          to: phone,
          bodyText: input.bodyText,
          buttons: input.buttons,
          headerText: input.headerText,
          footerText: input.footerText,
          apiBase: config.send_api_base ?? undefined,
        })
        return r.messageId
      }
      const r = await sendInteractiveList({
        phoneNumberId: config.phone_number_id,
        accessToken,
        to: phone,
        bodyText: input.bodyText,
        buttonLabel: input.buttonLabel,
        sections: input.sections,
        headerText: input.headerText,
        footerText: input.footerText,
        apiBase: config.send_api_base ?? undefined,
      })
      return r.messageId
    }

    // Same phone-variant retry as automations/meta-send.ts. Numbers
    // registered with/without a trunk 0 + Meta's sandbox quirks all
    // need this to reliably land a message.
    const variants = phoneVariants(sanitized)
    let workingPhone = sanitized
    let sentId = ''
    let lastError: unknown = null
    for (const v of variants) {
      try {
        sentId = await attempt(v)
        workingPhone = v
        lastError = null
        break
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (!isRecipientNotAllowedError(msg)) throw err
        lastError = err
      }
    }
    if (lastError) throw lastError
    waMessageId = sentId

    if (workingPhone !== sanitized) {
      await db.from('contacts').update({ phone: workingPhone }).eq('id', contact.id)
    }
  }

  // Persist the bot's prompt to the messages table so it appears in
  // the inbox. content_type='interactive' is supported as of
  // migration 010; sender_type='bot' distinguishes flow sends from
  // manual agent sends (the conversation list preview will pick up
  // last_message_text as a sensible summary).
  //
  // We do NOT set interactive_reply_id here — that column is reserved
  // for the customer's tap on this message, populated by the webhook
  // when their reply arrives. We DO persist the structured payload so
  // the inbox thread re-renders the buttons/rows the bot sent (round-
  // trip), matching the composer + automation send paths. Built above
  // (before the send) since the Zernio branch needs it too.
  const { error: msgErr } = await db.from('messages').insert({
    conversation_id: input.conversationId,
    sender_type: 'bot',
    content_type: 'interactive',
    content_text: input.bodyText,
    interactive_payload: interactivePayload,
    message_id: waMessageId,
    status: 'sent',
  })
  if (msgErr) {
    throw new Error(`sent to Meta but DB insert failed: ${msgErr.message}`)
  }

  await db
    .from('conversations')
    .update({
      last_message_text: input.bodyText,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.conversationId)

  return { whatsapp_message_id: waMessageId }
}
