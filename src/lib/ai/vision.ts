import type { SupabaseClient } from '@supabase/supabase-js'
import { AiError, type AiConfig } from './types'
import { aiRequestTimeoutMs } from './defaults'
import { providerHttpError, toNetworkError } from './providers/shared'
import { loadAiConfig } from './config'
import { downloadMedia, getMediaUrl } from '@/lib/whatsapp/meta-api'

// ============================================================
// Inbound image description (migration 046).
//
// Unlike voice-note transcription, both OpenAI and Anthropic accept
// image content natively in their normal chat endpoints, via the
// account's own existing chat api_key/model — no OpenRouter-style
// fallback provider needed.
//
// Mirrors transcribe.ts's shape: best-effort, never throws from the
// orchestrator. The description is stored on the image message's own
// `ai_image_description` column (NOT content_text, which stays the
// customer's own caption when they sent one — see the migration's
// comment) so buildConversationContext can fold it into the AI's view
// of the conversation without touching what the human agent sees in
// the inbox.
// ============================================================

const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions'
const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'
const MAX_DESCRIPTION_TOKENS = 300

const VISION_SYSTEM_PROMPT =
  "You are looking at an image from a WhatsApp customer-service conversation, on behalf of another assistant that only sees text. " +
  'Describe in 1-3 concise sentences what is relevant to the conversation: any product or item shown, visible text (prices, labels, receipts, error messages, screenshots), and the general subject. ' +
  'Do not greet, comment, or add anything besides the description.'

interface OpenAiVisionResponse {
  choices?: { message?: { content?: string } }[]
}

/** Describe an image with OpenAI's Chat Completions endpoint (vision-capable models accept an `image_url` content block). */
export async function describeImageWithOpenAi(
  apiKey: string,
  model: string,
  image: Buffer,
  mimeType: string,
  caption: string | null,
): Promise<string> {
  const timeoutMs = aiRequestTimeoutMs()
  const dataUrl = `data:${mimeType};base64,${image.toString('base64')}`
  const userContent: Record<string, unknown>[] = []
  if (caption) userContent.push({ type: 'text', text: `Caption from sender: ${caption}` })
  userContent.push({ type: 'image_url', image_url: { url: dataUrl } })

  let res: Response
  try {
    res = await fetch(OPENAI_CHAT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_completion_tokens: MAX_DESCRIPTION_TOKENS,
        messages: [
          { role: 'system', content: VISION_SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw toNetworkError(err)
  }

  if (!res.ok) throw await providerHttpError('OpenAI vision', res)

  const data = (await res.json().catch(() => null)) as OpenAiVisionResponse | null
  const text = data?.choices?.[0]?.message?.content?.trim()
  if (!text) {
    throw new AiError('OpenAI vision returned an empty description.', {
      code: 'empty_response',
    })
  }
  return text
}

interface AnthropicVisionResponse {
  content?: { type?: string; text?: string }[]
}

/** Describe an image with Anthropic's Messages endpoint (native `image` content block, base64 source). */
export async function describeImageWithAnthropic(
  apiKey: string,
  model: string,
  image: Buffer,
  mimeType: string,
  caption: string | null,
): Promise<string> {
  const timeoutMs = aiRequestTimeoutMs()
  const content: Record<string, unknown>[] = [
    {
      type: 'image',
      source: { type: 'base64', media_type: mimeType, data: image.toString('base64') },
    },
    { type: 'text', text: caption ? `Caption from sender: ${caption}` : 'Describe this image.' },
  ]

  let res: Response
  try {
    res = await fetch(ANTHROPIC_MESSAGES_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        system: VISION_SYSTEM_PROMPT,
        max_tokens: MAX_DESCRIPTION_TOKENS,
        messages: [{ role: 'user', content }],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw toNetworkError(err)
  }

  if (!res.ok) throw await providerHttpError('Anthropic vision', res)

  const data = (await res.json().catch(() => null)) as AnthropicVisionResponse | null
  const text = data?.content
    ?.filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('')
    .trim()
  if (!text) {
    throw new AiError('Anthropic vision returned an empty description.', {
      code: 'empty_response',
    })
  }
  return text
}

/** Describe an inbound image with the account's own configured provider + model. */
export async function describeInboundImage(
  config: Pick<AiConfig, 'provider' | 'apiKey' | 'model'>,
  image: Buffer,
  mimeType: string,
  caption: string | null = null,
): Promise<string> {
  if (config.provider === 'openai') {
    return describeImageWithOpenAi(config.apiKey, config.model, image, mimeType, caption)
  }
  return describeImageWithAnthropic(config.apiKey, config.model, image, mimeType, caption)
}

export interface DescribeAndStoreArgs {
  db: SupabaseClient
  accountId: string
  /** Internal UUID of the just-inserted `messages` row. */
  messageId: string
  /** Meta media id from the inbound webhook payload (`message.image.id`). */
  mediaId: string
  mimeType: string
  accessToken: string
  /** The caption the customer sent alongside the image, if any — folded
   *  into the vision prompt as extra context. */
  caption: string | null
}

/**
 * Download the image from Meta, describe it, and store the result on
 * `messages.ai_image_description`. Best-effort: swallows every failure
 * (no AI configured, download failure, provider error, DB error) and
 * logs rather than throws, since this runs inline in the webhook's
 * `after()` chain ahead of the AI auto-reply dispatch — a vision hiccup
 * must never stop a customer's message from being processed.
 *
 * Returns the description on success so the caller can also use it to
 * decide whether to dispatch the SAME inbound turn's auto-reply (which
 * otherwise only fires on non-empty text) without a second DB round trip.
 */
export async function describeAndStoreImageMessage(
  args: DescribeAndStoreArgs,
): Promise<string | null> {
  const { db, accountId, messageId, mediaId, mimeType, accessToken, caption } = args
  try {
    // requireActive: false — same posture as transcribeAndStoreAudioMessage:
    // this is a standalone convenience (lets a human agent see what's in
    // the photo without opening it) independent of the "Enable AI
    // assistant" master switch that gates drafting/auto-reply.
    const config = await loadAiConfig(db, accountId, { requireActive: false })
    if (!config) return null

    const mediaInfo = await getMediaUrl({ mediaId, accessToken })
    const { buffer } = await downloadMedia({
      downloadUrl: mediaInfo.url,
      accessToken,
    })

    const description = await describeInboundImage(config, buffer, mimeType, caption)
    if (!description) return null

    const { error } = await db
      .from('messages')
      .update({ ai_image_description: description })
      .eq('id', messageId)
    if (error) {
      console.error('[vision] failed to store image description:', error.message)
      return null
    }
    return description
  } catch (err) {
    console.error(
      '[vision] best-effort image description failed:',
      err instanceof Error ? err.message : err,
    )
    return null
  }
}
