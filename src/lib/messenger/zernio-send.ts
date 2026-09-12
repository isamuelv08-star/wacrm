// ============================================================
// Outbound send for a Facebook Page (Messenger) connected through
// Zernio — the Messenger counterpart to src/lib/whatsapp/zernio-send.ts.
//
// Much narrower than that file: Messenger has no template mechanism
// and no way to cold-start a business-initiated conversation the way
// WhatsApp's template + "Direct Send" paths do — Meta only allows
// replying inside a conversation the customer already started. So
// there is only one send shape here: reply inside an existing Zernio
// conversation.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { zernioClient } from '@/lib/whatsapp/zernio-client'

/**
 * The Zernio SocialAccount id for this account's connected Facebook
 * Page, or null when Messenger isn't Zernio-bridged for this account
 * (it may still be connected directly via a Page Access Token — see
 * src/lib/messenger/graph-api.ts — which /api/messenger/send checks
 * separately).
 */
export async function resolveZernioFacebookAccountId(
  db: SupabaseClient,
  accountId: string,
): Promise<string | null> {
  const { data } = await db
    .from('client_zernio_accounts')
    .select('facebook_account_id')
    .eq('account_id', accountId)
    .maybeSingle()
  return (data?.facebook_account_id as string | null) ?? null
}

export class ZernioMessengerSendError extends Error {}

export interface ZernioMessengerSendResult {
  messageId: string
}

export async function sendViaZernioMessenger(
  zernioSocialAccountId: string,
  existingZernioConversationId: string | null,
  params: {
    messageType: 'text' | 'image' | 'video' | 'audio' | 'document'
    contentText?: string | null
    mediaUrl?: string | null
    filename?: string | null
  },
): Promise<ZernioMessengerSendResult> {
  if (!existingZernioConversationId) {
    throw new ZernioMessengerSendError(
      'Messenger only allows replying inside a conversation the customer already started — there is no existing conversation to reply in yet.',
    )
  }

  const attachmentType =
    params.messageType === 'image' || params.messageType === 'video' || params.messageType === 'audio'
      ? params.messageType
      : params.messageType === 'document'
        ? 'file'
        : undefined

  const { data, error } = await zernioClient().messages.sendInboxMessage({
    path: { conversationId: existingZernioConversationId },
    body: {
      accountId: zernioSocialAccountId,
      message: params.contentText || undefined,
      attachmentUrl: attachmentType ? params.mediaUrl || undefined : undefined,
      attachmentType,
      attachmentName: attachmentType === 'file' ? params.filename || undefined : undefined,
    },
  })

  if (error || !data?.success || !data.data?.messageId) {
    const message =
      error && typeof error === 'object' && 'error' in error && typeof (error as { error?: unknown }).error === 'string'
        ? (error as { error: string }).error
        : 'Unknown error'
    throw new ZernioMessengerSendError(`Zernio send failed: ${message}`)
  }

  return { messageId: data.data.messageId }
}
