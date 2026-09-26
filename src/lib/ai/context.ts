import type { SupabaseClient } from '@supabase/supabase-js'
import type { ChatMessage } from './types'
import { aiContextMessageLimit } from './defaults'

export interface DbMessage {
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
export function resolveContent(m: DbMessage): string | null {
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

/** Messages read for a transcript-based analysis (classification, turn analysis). */
export const ANALYSIS_CONTEXT_LIMIT = 60

interface TranscriptRow {
  sender_type: 'customer' | 'agent' | 'bot'
  content_type: string
  content_text: string | null
  ai_image_description: string | null
  template_name: string | null
  sent_from_phone?: boolean | null
  created_at: string
}

/** One line of a transcript, or null for rows with nothing to show. */
export function transcriptLine(row: TranscriptRow, timezone: string | null = null): string | null {
  const who = row.sender_type === 'customer' ? 'Customer' : row.sender_type === 'bot' ? 'Bot' : 'Advisor'
  const text = row.content_text?.trim() ?? ''
  let body: string | null
  switch (row.content_type) {
    case 'image': {
      const parts = [text, row.ai_image_description?.trim()].filter(Boolean)
      body = parts.length ? `[Image] ${parts.join(' — ')}` : '[Image, no description]'
      break
    }
    case 'audio':
      body = text ? `[Voice note] ${text}` : '[Voice note, no transcript]'
      break
    case 'video':
      body = text ? `[Video] ${text}` : '[Video]'
      break
    case 'document':
      body = `[Document] ${text || 'file'}`
      break
    case 'template':
      body = `[Template${row.template_name ? ` "${row.template_name}"` : ''}]${text ? ` ${text}` : ''}`
      break
    default:
      body = text || null
  }
  if (!body) return null
  let when = row.created_at.slice(0, 16).replace('T', ' ')
  if (timezone) {
    try {
      when = new Intl.DateTimeFormat('sv-SE', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(row.created_at))
    } catch {
      // keep the UTC stamp
    }
  }
  return `[${when}] ${who}: ${body}`
}

/**
 * The conversation as ONE labelled, timestamped transcript for analysis
 * calls (lead classification, turn analysis). Unlike the chat replay the
 * reply uses, this:
 *   - tells Customer / Advisor (human) / Bot apart — a sale is often
 *     confirmed in the ADVISOR's message, and advisor and bot used to be
 *     the same "assistant" role;
 *   - carries timestamps, so "went quiet for 3 days" is visible;
 *   - includes documents (a PDF quote or receipt), templates and
 *     interactive taps, which the chat replay drops;
 *   - is a single user message, so the request never ends on an
 *     assistant turn (Anthropic treats that as a prefill to continue —
 *     classification on that account silently never produced JSON).
 */
export async function buildAnalysisTranscript(
  db: SupabaseClient,
  conversationId: string,
  opts: { limit?: number; timezone?: string | null } = {},
): Promise<{ transcript: string; lineCount: number; lastMessageAt: string | null }> {
  const { data, error } = await db
    .from('messages')
    .select('sender_type, content_type, content_text, ai_image_description, template_name, created_at')
    .eq('conversation_id', conversationId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(opts.limit ?? ANALYSIS_CONTEXT_LIMIT)
  let rows = data as TranscriptRow[] | null
  if (error) {
    // Pre-104 database: no deleted_at column.
    const retry = await db
      .from('messages')
      .select('sender_type, content_type, content_text, ai_image_description, template_name, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(opts.limit ?? ANALYSIS_CONTEXT_LIMIT)
    if (retry.error) throw retry.error
    rows = retry.data as TranscriptRow[] | null
  }
  const ordered = [...(rows ?? [])].reverse()
  const lines = ordered
    .map((r) => transcriptLine(r, opts.timezone ?? null))
    .filter((l): l is string => !!l)
  return {
    transcript: ['Conversation (oldest first):', ...lines].join('\n'),
    lineCount: lines.length,
    lastMessageAt: ordered[ordered.length - 1]?.created_at ?? null,
  }
}
