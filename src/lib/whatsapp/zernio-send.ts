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
// Interactive (button/list) sends aren't wired yet for Zernio — a
// known, explicit gap (see the thrown SendMessageError below), not a
// silent no-op.
// ============================================================

import { zernioClient } from '@/lib/whatsapp/zernio-client'
import { SendMessageError, type SendMessageParams } from '@/lib/whatsapp/send-message'

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
): Promise<ZernioSendResult> {
  const { messageType, contentText, mediaUrl, filename, templateName, templateLanguage, templateParams } =
    params

  if (messageType === 'interactive') {
    throw new SendMessageError(
      'unsupported_for_zernio',
      'Interactive button/list messages are not yet supported for WhatsApp accounts connected via Zernio. Use text, a media message, or a template instead.',
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
        message: contentText || undefined,
        attachmentUrl: attachmentType ? mediaUrl || undefined : undefined,
        attachmentType,
        attachmentName: attachmentType === 'file' ? filename || undefined : undefined,
        replyTo: contextMessageId,
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
