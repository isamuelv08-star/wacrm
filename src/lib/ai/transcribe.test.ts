import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  transcribeWithOpenAiWhisper,
  transcribeWithOpenRouter,
  transcribeInboundAudio,
  transcribeAndStoreAudioMessage,
} from './transcribe'
import { AiError } from './types'

beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
afterEach(() => vi.unstubAllGlobals())

function okTranscript(text: string): Response {
  return { ok: true, status: 200, json: async () => ({ text }) } as unknown as Response
}

describe('transcribeWithOpenAiWhisper', () => {
  it('posts a multipart upload with the caller key and returns the text', async () => {
    const fetchMock = vi.fn(async (url: string, opts: { headers: Record<string, string> }) => {
      expect(url).toContain('api.openai.com/v1/audio/transcriptions')
      expect(opts.headers.Authorization).toBe('Bearer sk-x')
      return okTranscript('hola, quiero cotizar')
    })
    vi.stubGlobal('fetch', fetchMock)

    const text = await transcribeWithOpenAiWhisper(
      'sk-x',
      Buffer.from('fake-audio'),
      'audio/ogg; codecs=opus',
    )
    expect(text).toBe('hola, quiero cotizar')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('maps a 401 to an invalid_key AiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: { message: 'bad key' } }),
      } as unknown as Response),
    )
    await expect(
      transcribeWithOpenAiWhisper('sk-bad', Buffer.from('x'), 'audio/ogg'),
    ).rejects.toMatchObject({ code: 'invalid_key' })
  })

  it('throws on an empty transcript', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okTranscript('   ')))
    await expect(
      transcribeWithOpenAiWhisper('sk-x', Buffer.from('x'), 'audio/ogg'),
    ).rejects.toBeInstanceOf(AiError)
  })
})

describe('transcribeWithOpenRouter', () => {
  it('posts base64 JSON with the caller key and returns the text', async () => {
    const fetchMock = vi.fn(async (url: string, opts: { headers: Record<string, string>; body: string }) => {
      expect(url).toContain('openrouter.ai/api/v1/audio/transcriptions')
      expect(opts.headers.Authorization).toBe('Bearer sk-or-x')
      const body = JSON.parse(opts.body)
      expect(body.model).toBe('openai/whisper-1')
      expect(body.input_audio.format).toBe('ogg')
      return okTranscript('necesito ayuda con mi pedido')
    })
    vi.stubGlobal('fetch', fetchMock)

    const text = await transcribeWithOpenRouter(
      'sk-or-x',
      Buffer.from('fake-audio'),
      'audio/ogg',
    )
    expect(text).toBe('necesito ayuda con mi pedido')
  })

  it('maps a non-2xx response to a provider AiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: { message: 'upstream failure' } }),
      } as unknown as Response),
    )
    await expect(
      transcribeWithOpenRouter('sk-or-x', Buffer.from('x'), 'audio/ogg'),
    ).rejects.toBeInstanceOf(AiError)
  })
})

describe('transcribeInboundAudio (hybrid dispatch)', () => {
  it('uses OpenAI Whisper directly when provider is openai, ignoring any transcriptionApiKey', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toContain('api.openai.com')
      return okTranscript('openai path')
    })
    vi.stubGlobal('fetch', fetchMock)

    const text = await transcribeInboundAudio(
      { provider: 'openai', apiKey: 'sk-x', transcriptionApiKey: 'sk-or-unused' },
      Buffer.from('x'),
      'audio/ogg',
    )
    expect(text).toBe('openai path')
  })

  it('falls back to OpenRouter when provider is anthropic and a transcription key is set', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toContain('openrouter.ai')
      return okTranscript('openrouter path')
    })
    vi.stubGlobal('fetch', fetchMock)

    const text = await transcribeInboundAudio(
      { provider: 'anthropic', apiKey: 'sk-ant-x', transcriptionApiKey: 'sk-or-x' },
      Buffer.from('x'),
      'audio/ogg',
    )
    expect(text).toBe('openrouter path')
  })

  it('resolves to null (no throw) when anthropic has no transcription key configured', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const text = await transcribeInboundAudio(
      { provider: 'anthropic', apiKey: 'sk-ant-x', transcriptionApiKey: null },
      Buffer.from('x'),
      'audio/ogg',
    )
    expect(text).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// ============================================================
// transcribeAndStoreAudioMessage — the best-effort orchestrator.
// Mocks loadAiConfig and the Meta media helpers so only the dispatch +
// DB-update + error-swallowing behavior is under test.
// ============================================================

const loadAiConfigMock = vi.fn()
vi.mock('./config', () => ({
  loadAiConfig: (...args: unknown[]) => loadAiConfigMock(...args),
}))

const getMediaUrlMock = vi.fn()
const downloadMediaMock = vi.fn()
vi.mock('@/lib/whatsapp/meta-api', () => ({
  getMediaUrl: (...args: unknown[]) => getMediaUrlMock(...args),
  downloadMedia: (...args: unknown[]) => downloadMediaMock(...args),
}))

function fakeUpdateDb(onUpdate: (payload: unknown, id: string) => void): SupabaseClient {
  return {
    from: () => ({
      update: (payload: unknown) => ({
        eq: (_col: string, id: string) => {
          onUpdate(payload, id)
          return Promise.resolve({ error: null })
        },
      }),
    }),
  } as unknown as SupabaseClient
}

describe('transcribeAndStoreAudioMessage', () => {
  beforeEach(() => {
    loadAiConfigMock.mockReset()
    getMediaUrlMock.mockReset()
    downloadMediaMock.mockReset()
  })

  it('returns null and never touches Meta when the account has no AI config', async () => {
    loadAiConfigMock.mockResolvedValue(null)
    const db = fakeUpdateDb(() => {
      throw new Error('should not update')
    })

    const result = await transcribeAndStoreAudioMessage({
      db,
      accountId: 'acct-1',
      messageId: 'msg-1',
      mediaId: 'media-1',
      mimeType: 'audio/ogg',
      accessToken: 'token',
    })

    expect(result).toBeNull()
    expect(getMediaUrlMock).not.toHaveBeenCalled()
  })

  it('returns null when provider is anthropic with no transcription key (no Meta call either)', async () => {
    loadAiConfigMock.mockResolvedValue({
      provider: 'anthropic',
      apiKey: 'sk-ant-x',
      transcriptionApiKey: null,
    })

    const result = await transcribeAndStoreAudioMessage({
      db: fakeUpdateDb(() => {
        throw new Error('should not update')
      }),
      accountId: 'acct-1',
      messageId: 'msg-1',
      mediaId: 'media-1',
      mimeType: 'audio/ogg',
      accessToken: 'token',
    })

    expect(result).toBeNull()
    expect(getMediaUrlMock).not.toHaveBeenCalled()
  })

  it('downloads, transcribes, and stores the transcript for an openai account', async () => {
    loadAiConfigMock.mockResolvedValue({
      provider: 'openai',
      apiKey: 'sk-x',
      transcriptionApiKey: null,
    })
    getMediaUrlMock.mockResolvedValue({ url: 'https://meta.example/media', mimeType: 'audio/ogg' })
    downloadMediaMock.mockResolvedValue({ buffer: Buffer.from('bytes'), contentType: 'audio/ogg' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okTranscript('me gustaria una cotizacion')))

    let updated: { payload: unknown; id: string } | null = null
    const db = fakeUpdateDb((payload, id) => {
      updated = { payload, id }
    })

    const result = await transcribeAndStoreAudioMessage({
      db,
      accountId: 'acct-1',
      messageId: 'msg-1',
      mediaId: 'media-1',
      mimeType: 'audio/ogg',
      accessToken: 'token',
    })

    expect(result).toBe('me gustaria una cotizacion')
    expect(updated).toEqual({
      payload: { content_text: 'me gustaria una cotizacion' },
      id: 'msg-1',
    })
  })

  it('swallows a provider failure and returns null rather than throwing', async () => {
    loadAiConfigMock.mockResolvedValue({
      provider: 'openai',
      apiKey: 'sk-x',
      transcriptionApiKey: null,
    })
    getMediaUrlMock.mockResolvedValue({ url: 'https://meta.example/media', mimeType: 'audio/ogg' })
    downloadMediaMock.mockResolvedValue({ buffer: Buffer.from('bytes'), contentType: 'audio/ogg' })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: { message: 'boom' } }),
      } as unknown as Response),
    )

    const result = await transcribeAndStoreAudioMessage({
      db: fakeUpdateDb(() => {
        throw new Error('should not update on failure')
      }),
      accountId: 'acct-1',
      messageId: 'msg-1',
      mediaId: 'media-1',
      mimeType: 'audio/ogg',
      accessToken: 'token',
    })

    expect(result).toBeNull()
  })
})
