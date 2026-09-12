import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { decrypt } from '@/lib/whatsapp/encryption'
import { sendTextMessage, sendAttachmentMessage, type MessengerAttachmentKind } from '@/lib/messenger/graph-api'
import {
  resolveZernioFacebookAccountId,
  sendViaZernioMessenger,
  ZernioMessengerSendError,
} from '@/lib/messenger/zernio-send'

// The Messenger counterpart to /api/whatsapp/send — same auth
// (agent-role gate + per-user rate limit) and the same request shape
// the inbox composer already sends (see message-thread.tsx), so the
// composer only needs to pick which of the two routes to call based
// on `getConversationPlatform(conversation)`, not build a different
// payload for each channel.
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')

    const limit = checkRateLimit(`send:${userId}`, RATE_LIMITS.send)
    if (!limit.success) {
      return rateLimitResponse(limit)
    }

    const body = await request.json()
    const {
      conversation_id,
      message_type,
      content_text,
      media_url,
      filename,
      reply_to_message_id,
    } = body

    if (!conversation_id || !message_type) {
      return NextResponse.json({ error: 'conversation_id and message_type are required' }, { status: 400 })
    }

    const ALLOWED_TYPES = new Set(['text', 'image', 'video', 'audio', 'document'])
    if (!ALLOWED_TYPES.has(message_type)) {
      return NextResponse.json(
        { error: `Unsupported message_type for Messenger: ${message_type}` },
        { status: 400 },
      )
    }
    if (message_type === 'text' && !content_text) {
      return NextResponse.json({ error: 'content_text is required for text messages' }, { status: 400 })
    }
    if (message_type !== 'text' && !media_url) {
      return NextResponse.json({ error: 'media_url is required for media messages' }, { status: 400 })
    }

    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select('id, contact_id, platform, unread_count, zernio_conversation_id')
      .eq('id', conversation_id)
      .eq('account_id', accountId)
      .maybeSingle()

    if (convError || !conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }
    if (conversation.platform !== 'messenger') {
      return NextResponse.json({ error: 'Conversation is not a Messenger conversation' }, { status: 400 })
    }

    const { data: contact, error: contactError } = await supabase
      .from('contacts')
      .select('id, messenger_psid')
      .eq('id', conversation.contact_id)
      .maybeSingle()

    if (contactError || !contact?.messenger_psid) {
      return NextResponse.json({ error: 'Contact has no Messenger PSID on file' }, { status: 400 })
    }

    // A Facebook Page connected through Zernio has no messenger_config
    // row at all — check that bridge FIRST, same "Zernio before direct
    // config" ordering src/lib/whatsapp/send-message.ts uses for WhatsApp.
    const zernioFacebookAccountId = await resolveZernioFacebookAccountId(supabase, accountId)

    let messageId: string
    if (zernioFacebookAccountId) {
      try {
        const result = await sendViaZernioMessenger(zernioFacebookAccountId, conversation.zernio_conversation_id, {
          messageType: message_type,
          contentText: content_text,
          mediaUrl: media_url,
          filename,
        })
        messageId = result.messageId
      } catch (err) {
        const message = err instanceof ZernioMessengerSendError ? err.message : 'Unknown Zernio error'
        return NextResponse.json({ error: `Messenger send failed: ${message}` }, { status: 502 })
      }
    } else {
      const { data: config, error: configError } = await supabase
        .from('messenger_config')
        .select('page_access_token')
        .eq('account_id', accountId)
        .maybeSingle()

      if (configError || !config) {
        return NextResponse.json({ error: 'Messenger is not connected for this account' }, { status: 400 })
      }

      let pageAccessToken: string
      try {
        pageAccessToken = decrypt(config.page_access_token)
      } catch {
        return NextResponse.json({ error: 'Stored Messenger token could not be decrypted' }, { status: 500 })
      }

      try {
        if (message_type === 'text') {
          const result = await sendTextMessage({
            pageAccessToken,
            recipientPsid: contact.messenger_psid,
            text: content_text,
          })
          messageId = result.messageId
        } else {
          const result = await sendAttachmentMessage({
            pageAccessToken,
            recipientPsid: contact.messenger_psid,
            kind: message_type as MessengerAttachmentKind,
            url: media_url,
          })
          messageId = result.messageId
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown Meta API error'
        return NextResponse.json({ error: `Messenger send failed: ${message}` }, { status: 502 })
      }
    }

    const contentText = message_type === 'document' ? (content_text || filename || 'Document') : content_text

    const { data: insertedMessage, error: insertError } = await supabase
      .from('messages')
      .insert({
        conversation_id,
        sender_type: 'agent',
        content_type: message_type,
        content_text: contentText,
        media_url: message_type === 'text' ? null : media_url,
        message_id: messageId,
        status: 'sent',
        reply_to_message_id: reply_to_message_id || null,
      })
      .select()
      .single()

    if (insertError) {
      console.error('[messenger/send] Error inserting message:', insertError)
      return NextResponse.json({ error: 'Message sent, but failed to save locally' }, { status: 500 })
    }

    await supabase
      .from('conversations')
      .update({
        last_message_text: contentText || `[${message_type}]`,
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversation_id)

    return NextResponse.json({ success: true, message: insertedMessage })
  } catch (err) {
    return toErrorResponse(err)
  }
}
