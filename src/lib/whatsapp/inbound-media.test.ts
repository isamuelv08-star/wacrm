import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const getMediaUrlMock = vi.fn()
const downloadMediaMock = vi.fn()
vi.mock('./meta-api', () => ({
  getMediaUrl: (...args: unknown[]) => getMediaUrlMock(...args),
  downloadMedia: (...args: unknown[]) => downloadMediaMock(...args),
}))

import { downloadInboundMedia, InboundMediaError } from './inbound-media'

beforeEach(() => {
  getMediaUrlMock.mockReset()
  downloadMediaMock.mockReset()
  vi.stubGlobal('fetch', vi.fn())
  process.env.ZERNIO_API_KEY = 'zk-test'
})
afterEach(() => vi.unstubAllGlobals())

describe('downloadInboundMedia — provider="meta"', () => {
  it('resolves the media URL then downloads it, preferring the actual response Content-Type', async () => {
    getMediaUrlMock.mockResolvedValue({ url: 'https://graph.example/media', mimeType: 'audio/ogg' })
    downloadMediaMock.mockResolvedValue({ buffer: Buffer.from('bytes'), contentType: 'audio/ogg; codecs=opus' })

    const result = await downloadInboundMedia({
      provider: 'meta',
      mediaId: 'media-1',
      accessToken: 'token',
    })

    expect(getMediaUrlMock).toHaveBeenCalledWith({ mediaId: 'media-1', accessToken: 'token' })
    expect(downloadMediaMock).toHaveBeenCalledWith({
      downloadUrl: 'https://graph.example/media',
      accessToken: 'token',
    })
    expect(result).toEqual({ buffer: Buffer.from('bytes'), mimeType: 'audio/ogg; codecs=opus' })
  })

  it('throws when no accessToken is supplied', async () => {
    await expect(
      downloadInboundMedia({ provider: 'meta', mediaId: 'media-1' }),
    ).rejects.toBeInstanceOf(InboundMediaError)
  })
})

describe('downloadInboundMedia — provider="zernio"', () => {
  function tokenFor(url: string): string {
    return Buffer.from(url, 'utf8').toString('base64url')
  }

  it('decodes the token, fetches with the Zernio API key, and returns the response bytes/content-type', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Map([['content-type', 'audio/ogg']]),
      arrayBuffer: async () => new TextEncoder().encode('bytes').buffer,
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await downloadInboundMedia({
      provider: 'zernio',
      mediaId: tokenFor('https://zernio.com/attachments/abc'),
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://zernio.com/attachments/abc',
      { headers: { Authorization: 'Bearer zk-test' } },
    )
    expect(result.mimeType).toBe('audio/ogg')
    expect(Buffer.from(result.buffer).toString()).toBe('bytes')
  })

  it('rejects a token that decodes to a non-Zernio host (SSRF guard)', async () => {
    await expect(
      downloadInboundMedia({ provider: 'zernio', mediaId: tokenFor('https://evil.example/steal') }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('rejects a token that decodes to a non-https Zernio URL', async () => {
    await expect(
      downloadInboundMedia({ provider: 'zernio', mediaId: tokenFor('http://zernio.com/attachments/abc') }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('rejects a malformed (non-base64url, non-URL) token', async () => {
    await expect(
      downloadInboundMedia({ provider: 'zernio', mediaId: 'not-a-valid-token!!' }),
    ).rejects.toBeInstanceOf(InboundMediaError)
  })

  it('surfaces a missing ZERNIO_API_KEY as a 500', async () => {
    delete process.env.ZERNIO_API_KEY
    await expect(
      downloadInboundMedia({ provider: 'zernio', mediaId: tokenFor('https://zernio.com/x') }),
    ).rejects.toMatchObject({ status: 500 })
  })

  it('maps an upstream non-2xx response to a 502', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }))
    await expect(
      downloadInboundMedia({ provider: 'zernio', mediaId: tokenFor('https://zernio.com/x') }),
    ).rejects.toMatchObject({ status: 502 })
  })
})
