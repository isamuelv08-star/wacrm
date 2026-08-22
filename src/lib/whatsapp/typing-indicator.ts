import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import { sendTypingIndicator } from '@/lib/whatsapp/meta-api'
import { resolveZernioSocialAccountId, sendZernioTypingIndicator } from '@/lib/whatsapp/zernio-send'

/**
 * Shows a "typing..." bubble on the customer's side of a conversation.
 * Called right before the AI auto-reply starts generating a response
 * (and again before each part of a multi-part reply — the indicator
 * clears the instant a message actually sends) so a reply reads as
 * someone actually there, not a message that just appears instantly.
 *
 * Best-effort and silent: a failure here must never block or fail the
 * reply itself, so every branch swallows its own errors.
 */
export async function signalTyping(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
): Promise<void> {
  try {
    const zernioSocialAccountId = await resolveZernioSocialAccountId(db, accountId)
    if (zernioSocialAccountId) {
      const { data: conv } = await db
        .from('conversations')
        .select('zernio_conversation_id')
        .eq('id', conversationId)
        .maybeSingle()
      const zernioConversationId = conv?.zernio_conversation_id as string | null
      if (zernioConversationId) {
        await sendZernioTypingIndicator(zernioSocialAccountId, zernioConversationId)
      }
      return
    }

    const { data: config } = await db
      .from('whatsapp_config')
      .select('phone_number_id, access_token, send_api_base')
      .eq('account_id', accountId)
      .maybeSingle()
    if (!config) return

    // The customer's most recent inbound message — Meta requires its
    // wamid to show the indicator (and marks it read as a side effect).
    const { data: lastInbound } = await db
      .from('messages')
      .select('message_id')
      .eq('conversation_id', conversationId)
      .eq('sender_type', 'customer')
      .not('message_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!lastInbound?.message_id) return

    await sendTypingIndicator({
      phoneNumberId: config.phone_number_id,
      accessToken: decrypt(config.access_token),
      messageId: lastInbound.message_id,
      apiBase: config.send_api_base ?? undefined,
    })
  } catch (err) {
    console.warn('[typing-indicator] signalTyping failed (non-fatal):', err)
  }
}
