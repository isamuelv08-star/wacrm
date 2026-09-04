import type { SupabaseClient } from '@supabase/supabase-js'
import { AiError, type AiConfig } from './types'
import { aiRequestTimeoutMs } from './defaults'
import { providerHttpError, toNetworkError } from './providers/shared'
import { loadAiConfig } from './config'

// ============================================================
// Voice-note transcription (migration 041).
//
// Hybrid provider strategy — see the migration's doc comment:
//   - provider = 'openai'     → Whisper directly, via the account's own
//     (already-stored) chat api_key. Zero extra setup.
//   - provider = 'openrouter' → OpenRouter's unified transcription
//     endpoint, via that SAME chat api_key — it's already an
//     OpenRouter key, no separate transcription key needed.
//   - provider = 'anthropic'  → OpenRouter's unified transcription
//     endpoint, via the optional transcription_api_key, since Anthropic
//     has no native transcription API of its own.
//   - Neither key available   → transcribeInboundAudio resolves to null;
//     the caller leaves the message as a plain (untranscribed) audio
//     bubble, exactly like today.
//
// Best-effort throughout: the provider-calling functions below throw
// `AiError` on failure (same contract as generateReply/embedTexts), but
// the orchestrator `transcribeAndStoreAudioMessage` owns its own
// try/catch and NEVER throws — it runs inside the webhook's `after()`
// chain and a slow/failing transcription must not break message
// processing or the AI auto-reply that follows it.
// ============================================================

const OPENAI_TRANSCRIBE_URL = 'https://api.openai.com/v1/audio/transcriptions'
const OPENROUTER_TRANSCRIBE_URL = 'https://openrouter.ai/api/v1/audio/transcriptions'
const OPENAI_WHISPER_MODEL = 'whisper-1'
const OPENROUTER_WHISPER_MODEL = 'openai/whisper-1'

interface WhisperResponse {
  text?: string
}

/** WhatsApp voice notes are almost always audio/ogg (Opus); the other
 *  cases cover forwarded clips in other formats. Falls back to 'ogg' —
 *  both providers accept it and WhatsApp audio is never anything exotic. */
function extensionForMimeType(mimeType: string): string {
  const base = mimeType.split(';')[0].trim().toLowerCase()
  switch (base) {
    case 'audio/ogg':
      return 'ogg'
    case 'audio/mpeg':
      return 'mp3'
    case 'audio/mp4':
      return 'mp4'
    case 'audio/aac':
      return 'aac'
    case 'audio/amr':
      return 'amr'
    default:
      return 'ogg'
  }
}

/**
 * Transcribe with OpenAI's Whisper endpoint using the account's own chat
 * key. Multipart upload — OpenAI infers the codec from the filename
 * extension / content type, no separate `format` field needed.
 */
export async function transcribeWithOpenAiWhisper(
  apiKey: string,
  audio: Buffer,
  mimeType: string,
): Promise<string> {
  const timeoutMs = aiRequestTimeoutMs()
  const ext = extensionForMimeType(mimeType)
  const form = new FormData()
  // `new Uint8Array(audio)` copies into a plain-ArrayBuffer-backed view —
  // a Node Buffer's underlying ArrayBufferLike can widen to
  // SharedArrayBuffer, which BlobPart's typing rejects directly.
  form.append(
    'file',
    new Blob([new Uint8Array(audio)], { type: mimeType }),
    `audio.${ext}`,
  )
  form.append('model', OPENAI_WHISPER_MODEL)

  let res: Response
  try {
    res = await fetch(OPENAI_TRANSCRIBE_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw toNetworkError(err)
  }

  if (!res.ok) throw await providerHttpError('OpenAI Whisper', res)

  const data = (await res.json().catch(() => null)) as WhisperResponse | null
  const text = data?.text?.trim()
  if (!text) {
    throw new AiError('OpenAI Whisper returned an empty transcript.', {
      code: 'empty_response',
    })
  }
  return text
}

/**
 * Transcribe via OpenRouter's unified `/api/v1/audio/transcriptions`
 * (launched July 2026) — same request/response shape as OpenAI's own
 * Whisper endpoint, base64 JSON body instead of multipart.
 */
export async function transcribeWithOpenRouter(
  apiKey: string,
  audio: Buffer,
  mimeType: string,
): Promise<string> {
  const timeoutMs = aiRequestTimeoutMs()
  const format = extensionForMimeType(mimeType)

  let res: Response
  try {
    res = await fetch(OPENROUTER_TRANSCRIBE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: OPENROUTER_WHISPER_MODEL,
        input_audio: { data: audio.toString('base64'), format },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw toNetworkError(err)
  }

  if (!res.ok) throw await providerHttpError('OpenRouter transcription', res)

  const data = (await res.json().catch(() => null)) as WhisperResponse | null
  const text = data?.text?.trim()
  if (!text) {
    throw new AiError('OpenRouter returned an empty transcript.', {
      code: 'empty_response',
    })
  }
  return text
}

/**
 * Pick the right path per the hybrid rule and transcribe. Returns null
 * (no throw) when the account has neither an OpenAI key nor an
 * OpenRouter transcription key configured — "not available" is a valid,
 * silent outcome here, distinct from "attempted and failed".
 */
export async function transcribeInboundAudio(
  config: Pick<AiConfig, 'provider' | 'apiKey' | 'transcriptionApiKey'>,
  audio: Buffer,
  mimeType: string,
): Promise<string | null> {
  if (config.provider === 'openai') {
    return transcribeWithOpenAiWhisper(config.apiKey, audio, mimeType)
  }
  // An 'openrouter' account's main chat key already IS an OpenRouter
  // key — use it directly rather than requiring the separate optional
  // transcriptionApiKey, which exists specifically for 'anthropic'
  // accounts that have no OpenRouter key of their own.
  if (config.provider === 'openrouter') {
    return transcribeWithOpenRouter(config.apiKey, audio, mimeType)
  }
  if (config.transcriptionApiKey) {
    return transcribeWithOpenRouter(config.transcriptionApiKey, audio, mimeType)
  }
  return null
}

export interface TranscribeAndStoreArgs {
  db: SupabaseClient
  accountId: string
  /** Internal UUID of the just-inserted `messages` row (content_text
   *  starts null for audio; this call fills it in after the fact). */
  messageId: string
  /** Already-downloaded voice-note bytes — the caller fetches these
   *  however its provider requires (Meta Graph API, a Zernio-bridged
   *  attachment, ...) via `downloadInboundMedia`
   *  (src/lib/whatsapp/inbound-media.ts). This function no longer
   *  cares which provider the message came from. */
  audio: Buffer
  mimeType: string
}

/**
 * Transcribe an already-downloaded voice note and store the result on
 * the message's own `content_text`. Best-effort: swallows every
 * failure (no AI configured, decrypt failure, provider error, DB
 * error) and logs rather than throws, since this runs inline in the
 * webhook's `after()` chain ahead of the AI auto-reply dispatch — a
 * transcription hiccup must never stop a customer's message from
 * being processed.
 *
 * Returns the transcript on success so the caller can also feed it into
 * the SAME inbound turn's auto-reply gating (which otherwise only
 * fires on non-empty text) without a second DB round trip.
 */
export async function transcribeAndStoreAudioMessage(
  args: TranscribeAndStoreArgs,
): Promise<string | null> {
  const { db, accountId, messageId, audio, mimeType } = args
  try {
    // requireActive: false — transcription is a standalone convenience
    // (so the team can read a voice note without listening to it) and
    // shouldn't depend on the "Enable AI assistant" master switch that
    // gates drafting/auto-reply.
    const config = await loadAiConfig(db, accountId, { requireActive: false })
    if (!config) return null
    // Mirrors transcribeInboundAudio's hybrid rule: 'openai' and
    // 'openrouter' can always transcribe with their own main key;
    // 'anthropic' needs the separate optional transcriptionApiKey.
    const canTranscribe =
      config.provider === 'openai' ||
      config.provider === 'openrouter' ||
      Boolean(config.transcriptionApiKey)
    if (!canTranscribe) return null

    const text = await transcribeInboundAudio(config, audio, mimeType)
    if (!text) return null

    const { error } = await db
      .from('messages')
      .update({ content_text: text })
      .eq('id', messageId)
    if (error) {
      console.error('[transcribe] failed to store transcript:', error.message)
      return null
    }
    return text
  } catch (err) {
    console.error(
      '[transcribe] best-effort transcription failed:',
      err instanceof Error ? err.message : err,
    )
    return null
  }
}
