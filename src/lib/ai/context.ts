import type { SupabaseClient } from '@supabase/supabase-js'
import type { ChatMessage } from './types'
import { aiContextMessageLimit } from './defaults'

interface DbMessage {
  sender_type: 'customer' | 'agent' | 'bot'
  content_type?: 'text' | 'audio' | 'image' | 'video'
  content_text: string | null
  ai_image_description?: string | null
}

/**
 * Resolve the text a row contributes to the model's view of the
 * conversation. Text rows use `content_text` as-is. Image rows combine
 * the customer's own caption (if any, still `content_text` — untouched,
 * so the inbox keeps showing exactly what they wrote) with the
 * AI-generated `ai_image_description` (migration 046, kept in its own
 * column precisely so it never overwrites that caption).
 *
 * Audio and video have no content-understanding pipeline of their own
 * (audio gets a real transcript into `content_text` when transcription
 * is configured — migration 041 — but there's no equivalent for video).
 * Rather than silently vanish from context whenever that transcript/
 * caption is missing — which left the bot answering a turn with no
 * idea the customer had just sent something, and the standalone lead
 * classifier scoring on an incomplete conversation — both fall back to
 * a plain marker so the model at least knows a video/voice message
 * arrived, even without understanding its contents.
 */
function resolveContent(m: DbMessage): string | null {
  if (m.content_type === 'image') {
    const parts = [m.content_text, m.ai_image_description]
      .map((p) => p?.trim())
      .filter((p): p is string => !!p)
    return parts.length ? parts.join('\n') : null
  }
  if (m.content_type === 'video') {
    const caption = m.content_text?.trim()
    return caption ? `[Video] ${caption}` : '[Customer sent a video]'
  }
  if (m.content_type === 'audio') {
    const transcript = m.content_text?.trim()
    return transcript || '[Customer sent a voice message; no transcript available]'
  }
  return m.content_text
}

/**
 * Fetch the last N text messages of a conversation and map them to the
 * provider-neutral chat shape. Customer messages become `user`; agent
 * and bot messages become `assistant`. Other media (video, documents,
 * templates, interactive) are excluded — they carry no text to model.
 *
 * Ordered oldest-first (chronological) so the transcript reads
 * naturally and the most recent customer message lands last.
 */
export async function buildConversationContext(
  db: SupabaseClient,
  conversationId: string,
  limit: number = aiContextMessageLimit(),
): Promise<ChatMessage[]> {
  const { data, error } = await db
    .from('messages')
    .select('sender_type, content_type, content_text, ai_image_description')
    .eq('conversation_id', conversationId)
    .in('content_type', ['text', 'audio', 'image', 'video'])
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error

  const rows = ((data ?? []) as DbMessage[]).reverse()
  return rows
    .map((m) => ({ role: m.sender_type, content: resolveContent(m) }))
    .filter((m): m is { role: DbMessage['sender_type']; content: string } =>
      !!m.content && !!m.content.trim(),
    )
    .map((m) => ({
      role: m.role === 'customer' ? ('user' as const) : ('assistant' as const),
      content: m.content.trim(),
    }))
}
