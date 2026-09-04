import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  describeImageWithOpenAi,
  describeImageWithAnthropic,
  describeInboundImage,
  describeAndStoreImageMessage,
} from './vision'
import { AiError } from './types'

beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
afterEach(() => vi.unstubAllGlobals())

function okOpenAi(text: string): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: text } }] }),
  } as unknown as Response
}

function okAnthropic(text: string): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ content: [{ type: 'text', text }] }),
  } as unknown as Response
}

describe('describeImageWithOpenAi', () => {
  it('posts an image_url content block with the caller key and returns the description', async () => {
    const fetchMock = vi.fn(async (url: string, opts: { headers: Record<string, string>; body: string }) => {
      expect(url).toContain('api.openai.com/v1/chat/completions')
      expect(opts.headers.Authorization).toBe('Bearer sk-x')
      const body = JSON.parse(opts.body)
      const userMsg = body.messages[1]
      expect(userMsg.role).toBe('user')
      expect(userMsg.content.some((c: { type: string }) => c.type === 'image_url')).toBe(true)
      return okOpenAi('A red hoodie with a $45 price tag.')
    })
    vi.stubGlobal('fetch', fetchMock)

    const text = await describeImageWithOpenAi(
      'sk-x',
      'gpt-test',
      Buffer.from('fake-image'),
      'image/jpeg',
      null,
    )
    expect(text).toBe('A red hoodie with a $45 price tag.')
  })

  it('includes the sender caption as a leading text block when given', async () => {
    const fetchMock = vi.fn(async (_url: string, opts: { body: string }) => {
      const body = JSON.parse(opts.body)
      const userMsg = body.messages[1]
      expect(userMsg.content[0]).toEqual({ type: 'text', text: 'Caption from sender: it arrived broken' })
      return okOpenAi('A cracked phone screen.')
    })
    vi.stubGlobal('fetch', fetchMock)

    await describeImageWithOpenAi(
      'sk-x',
      'gpt-test',
      Buffer.from('x'),
      'image/jpeg',
      'it arrived broken',
    )
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
      describeImageWithOpenAi('sk-bad', 'gpt-test', Buffer.from('x'), 'image/jpeg', null),
    ).rejects.toMatchObject({ code: 'invalid_key' })
  })

  it('throws on an empty description', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okOpenAi('   ')))
    await expect(
      describeImageWithOpenAi('sk-x', 'gpt-test', Buffer.from('x'), 'image/jpeg', null),
    ).rejects.toBeInstanceOf(AiError)
  })
})

describe('describeImageWithAnthropic', () => {
  it('posts a base64 image content block and returns the description', async () => {
    const fetchMock = vi.fn(async (url: string, opts: { headers: Record<string, string>; body: string }) => {
      expect(url).toContain('api.anthropic.com/v1/messages')
      expect(opts.headers['x-api-key']).toBe('sk-ant-x')
      const body = JSON.parse(opts.body)
      const content = body.messages[0].content
      expect(content[0]).toMatchObject({ type: 'image', source: { type: 'base64', media_type: 'image/png' } })
      return okAnthropic('A grocery receipt totaling $32.50.')
    })
    vi.stubGlobal('fetch', fetchMock)

    const text = await describeImageWithAnthropic(
      'sk-ant-x',
      'claude-test',
      Buffer.from('fake-image'),
      'image/png',
      null,
    )
    expect(text).toBe('A grocery receipt totaling $32.50.')
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
      describeImageWithAnthropic('sk-ant-x', 'claude-test', Buffer.from('x'), 'image/png', null),
    ).rejects.toBeInstanceOf(AiError)
  })
})

describe('describeInboundImage (provider dispatch)', () => {
  it('routes to OpenAI when provider is openai', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toContain('api.openai.com')
      return okOpenAi('openai path')
    })
    vi.stubGlobal('fetch', fetchMock)

    const text = await describeInboundImage(
      { provider: 'openai', apiKey: 'sk-x', model: 'gpt-test' },
      Buffer.from('x'),
      'image/jpeg',
    )
    expect(text).toBe('openai path')
  })

  it('routes to Anthropic when provider is anthropic', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toContain('api.anthropic.com')
      return okAnthropic('anthropic path')
    })
    vi.stubGlobal('fetch', fetchMock)

    const text = await describeInboundImage(
      { provider: 'anthropic', apiKey: 'sk-ant-x', model: 'claude-test' },
      Buffer.from('x'),
      'image/jpeg',
    )
    expect(text).toBe('anthropic path')
  })
})

// ============================================================
// describeAndStoreImageMessage — the best-effort orchestrator. Mocks
// loadAiConfig so only the dispatch + DB-update + error-swallowing
// behavior is under test; the caller is now responsible for
// downloading the image bytes (see src/lib/whatsapp/inbound-media.ts),
// so this function itself no longer touches Meta/Zernio at all.
// ============================================================

const loadAiConfigMock = vi.fn()
vi.mock('./config', () => ({
  loadAiConfig: (...args: unknown[]) => loadAiConfigMock(...args),
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

describe('describeAndStoreImageMessage', () => {
  beforeEach(() => {
    loadAiConfigMock.mockReset()
  })

  it('returns null and never calls the provider when the account has no AI config', async () => {
    loadAiConfigMock.mockResolvedValue(null)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const db = fakeUpdateDb(() => {
      throw new Error('should not update')
    })

    const result = await describeAndStoreImageMessage({
      db,
      accountId: 'acct-1',
      messageId: 'msg-1',
      image: Buffer.from('bytes'),
      mimeType: 'image/jpeg',
      caption: null,
    })

    expect(result).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('describes already-downloaded bytes and stores the description on ai_image_description', async () => {
    loadAiConfigMock.mockResolvedValue({ provider: 'openai', apiKey: 'sk-x', model: 'gpt-test' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okOpenAi('A pair of white sneakers, size 42 visible on the box.')))

    let updated: { payload: unknown; id: string } | null = null
    const db = fakeUpdateDb((payload, id) => {
      updated = { payload, id }
    })

    const result = await describeAndStoreImageMessage({
      db,
      accountId: 'acct-1',
      messageId: 'msg-1',
      image: Buffer.from('bytes'),
      mimeType: 'image/jpeg',
      caption: null,
    })

    expect(result).toBe('A pair of white sneakers, size 42 visible on the box.')
    expect(updated).toEqual({
      payload: { ai_image_description: 'A pair of white sneakers, size 42 visible on the box.' },
      id: 'msg-1',
    })
  })

  it('swallows a provider failure and returns null rather than throwing', async () => {
    loadAiConfigMock.mockResolvedValue({ provider: 'openai', apiKey: 'sk-x', model: 'gpt-test' })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: { message: 'boom' } }),
      } as unknown as Response),
    )

    const result = await describeAndStoreImageMessage({
      db: fakeUpdateDb(() => {
        throw new Error('should not update on failure')
      }),
      accountId: 'acct-1',
      messageId: 'msg-1',
      image: Buffer.from('bytes'),
      mimeType: 'image/jpeg',
      caption: null,
    })

    expect(result).toBeNull()
  })
})
