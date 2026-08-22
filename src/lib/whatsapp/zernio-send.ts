// ============================================================
// Outbound send for Zernio-bridged WhatsApp accounts — the Zernio
// counterpart to meta-api.ts's send helpers, called from
// send-message.ts when the account has no whatsapp_config row but
// does have a client_zernio_accounts.whatsapp_account_id.
//
// Zernio's inbox API distinguishes "start a new conversation"
// (POST /v1/inbox/conversations — required for a business-initiated
// WhatsApp thread outside the 24h customer-service window, so it only
// accepts a template or a Direct-Send-eligible text message, same
// real-world constraint Meta itself enforces) from "reply in an
// existing one" (POST /v1/inbox/conversations/{id}/messages — accepts
// media, buttons, etc., but only inside that window). We mirror that
// split here rather than papering over it: media/interactive on a
// brand-new thread is a genuine Meta limitation, not a gap in this
// bridge.
//
// Interactive (button/list) sends build the same raw Meta objects
// meta-api.ts's sendInteractiveButtons/sendInteractiveList already
// construct — Zernio's `buttons` field for the ≤3-button case, and its
// `interactive` field (forwarded to Meta verbatim) for the list case,
// which Meta itself requires to open a NEW conversation (they're
// session-only, so an interactive send with no existing thread is a
// genuine Meta limitation, not a gap here — see the check below).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { zernioClient } from '@/lib/whatsapp/zernio-client'
import { SendMessageError, type SendMessageParams } from '@/lib/whatsapp/send-message'
import type { InteractiveMessagePayload } from '@/lib/whatsapp/interactive'

/**
 * The Zernio SocialAccount id for this account's WhatsApp channel, or
 * null when it's not Zernio-bridged (direct-Meta / Dualhook instead).
 * Every outbound sender (dashboard send, AI auto-reply, Flows,
 * Automations) checks this FIRST, before touching whatsapp_config —
 * a Zernio-connected account has no row there at all.
 */
export async function resolveZernioSocialAccountId(
  db: SupabaseClient,
  accountId: string,
): Promise<string | null> {
  const { data } = await db
    .from('client_zernio_accounts')
    .select('whatsapp_account_id')
    .eq('account_id', accountId)
    .maybeSingle()
  return (data?.whatsapp_account_id as string | null) ?? null
}

/**
 * Best-effort "typing..." bubble for a Zernio-bridged conversation.
 * Zernio resolves which inbound message to mark read/reference
 * internally (no wamid needed from us, unlike the direct-Meta path).
 * Silently no-ops on failure — this is cosmetic, never worth
 * interrupting a reply over.
 */
export async function sendZernioTypingIndicator(
  zernioSocialAccountId: string,
  zernioConversationId: string,
): Promise<void> {
  try {
    await zernioClient().messages.sendTypingIndicator({
      path: { conversationId: zernioConversationId },
      body: { accountId: zernioSocialAccountId },
    })
  } catch (err) {
    console.warn('[zernio-send] typing indicator failed (non-fatal):', err)
  }
}

export interface ZernioSendResult {
  waMessageId: string
  /** Set only when this call created a brand-new Zernio conversation. */
  zernioConversationId: string | null
}

export async function sendViaZernio(
  zernioSocialAccountId: string,
  existingZernioConversationId: string | null,
  recipientPhone: string,
  params: Pick<
    SendMessageParams,
    | 'messageType'
    | 'contentText'
    | 'mediaUrl'
    | 'filename'
    | 'templateName'
    | 'templateLanguage'
    | 'templateParams'
  >,
  /** Meta wamid of the message being swipe-replied to, if any. */
  contextMessageId?: string,
  /** Required when messageType === 'interactive'. */
  interactivePayload?: InteractiveMessagePayload | null,
): Promise<ZernioSendResult> {
  const { messageType, contentText, mediaUrl, filename, templateName, templateLanguage, templateParams } =
    params

  if (messageType === 'interactive' && !existingZernioConversationId) {
    throw new SendMessageError(
      'bad_request',
      'Interactive (button/list) messages are session-only on WhatsApp — they need an existing conversation and can\'t open a new one. Use a template to start the thread.',
      400,
    )
  }

  const client = zernioClient()

  if (existingZernioConversationId) {
    const attachmentType =
      messageType === 'image' || messageType === 'video' || messageType === 'audio'
        ? messageType
        : messageType === 'document'
          ? 'file'
          : undefined

    const { data, error } = await client.messages.sendInboxMessage({
      path: { conversationId: existingZernioConversationId },
      body: {
        accountId: zernioSocialAccountId,
        // The list case's body text lives inside the raw `interactive`
        // object built below — setting it here too would send it twice.
        message:
          messageType === 'interactive'
            ? interactivePayload!.kind === 'buttons'
              ? interactivePayload!.body
              : undefined
            : contentText || undefined,
        attachmentUrl: attachmentType ? mediaUrl || undefined : undefined,
        attachmentType,
        attachmentName: attachmentType === 'file' ? filename || undefined : undefined,
        replyTo: contextMessageId,
        buttons:
          messageType === 'interactive' && interactivePayload!.kind === 'buttons'
            ? interactivePayload!.buttons.map((b) => ({
                type: 'postback' as const,
                title: b.title,
                payload: b.id,
              }))
            : undefined,
        interactive:
          messageType === 'interactive' && interactivePayload!.kind === 'list'
            ? buildMetaListInteractive(interactivePayload!)
            : undefined,
        template:
          messageType === 'template' && templateName
            ? {
                elements: [
                  {
                    name: templateName,
                    language: templateLanguage || 'en_US',
                    ...(templateParams && templateParams.length > 0
                      ? { components: buildTemplateComponents(templateParams) }
                      : {}),
                  },
                ],
              }
            : undefined,
      },
    })

    if (error || !data?.success || !data.data?.messageId) {
      throw new SendMessageError(
        'zernio_error',
        `Zernio send failed: ${zernioErrorMessage(error)}`,
        502,
      )
    }
    return { waMessageId: data.data.messageId, zernioConversationId: null }
  }

  // No thread yet — must be a template, or a Direct-Send-eligible
  // plain-text business-initiated message.
  if (messageType !== 'template' && messageType !== 'text') {
    throw new SendMessageError(
      'bad_request',
      'Start this conversation with a message template — WhatsApp only allows a template (or a Direct Send-eligible text message) to open a new business-initiated thread.',
      400,
    )
  }

  const { data, error } = await client.messages.createInboxConversation({
    body: {
      accountId: zernioSocialAccountId,
      participantId: recipientPhone,
      message: messageType === 'text' ? contentText || undefined : undefined,
      category: messageType === 'text' ? 'utility' : undefined,
      templateName: messageType === 'template' ? templateName || undefined : undefined,
      templateLanguage: messageType === 'template' ? templateLanguage || 'en_US' : undefined,
      templateParams: messageType === 'template' ? templateParams : undefined,
    },
  })

  if (error || !data?.success || !data.data?.messageId || !data.data.conversationId) {
    throw new SendMessageError(
      'zernio_error',
      `Zernio send failed: ${zernioErrorMessage(error)}`,
      502,
    )
  }

  return {
    waMessageId: data.data.messageId,
    zernioConversationId: data.data.conversationId,
  }
}

/**
 * Meta's raw Cloud API `interactive` list object — mirrors
 * meta-api.ts's sendInteractiveList exactly (field-for-field), since
 * Zernio forwards this object to Meta verbatim.
 */
function buildMetaListInteractive(payload: Extract<InteractiveMessagePayload, { kind: 'list' }>) {
  const interactive: Record<string, unknown> = {
    type: 'list',
    body: { text: payload.body },
    action: {
      button: payload.button_label,
      sections: payload.sections.map((s) => ({
        ...(s.title ? { title: s.title } : {}),
        rows: s.rows.map((r) => ({
          id: r.id,
          title: r.title,
          ...(r.description ? { description: r.description } : {}),
        })),
      })),
    },
  }
  if (payload.header) interactive.header = { type: 'text', text: payload.header }
  if (payload.footer) interactive.footer = { text: payload.footer }
  return interactive
}

/**
 * Our stored `templateParams` is a flat positional array (see
 * SendMessageParams' doc comment). Zernio forwards `template.components`
 * to Meta's Cloud API verbatim, so build the one-component body shape
 * Meta expects from that flat list — matches how meta-api.ts's own
 * template builder treats the same array for the direct-Meta path.
 */
function buildTemplateComponents(params: string[]) {
  return [
    {
      type: 'body',
      parameters: params.map((text) => ({ type: 'text', text })),
    },
  ]
}

function zernioErrorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'error' in error) {
    const e = (error as { error?: unknown }).error
    if (typeof e === 'string') return e
  }
  return 'Unknown error'
}
