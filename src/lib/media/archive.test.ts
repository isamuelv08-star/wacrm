import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: (v: string) => v }))

const { mediaSourceFromUrl, storedMediaRoute } = await import('./archive')

describe('mediaSourceFromUrl', () => {
  it('recognises the Meta proxy', () => {
    expect(mediaSourceFromUrl('/api/whatsapp/media/123456789')).toEqual({ kind: 'meta', mediaId: '123456789' })
  })
  it('recognises the Zernio proxy before the Meta one', () => {
    expect(mediaSourceFromUrl('/api/whatsapp/media/zernio/aHR0cHM6Ly94')).toEqual({
      kind: 'zernio',
      token: 'aHR0cHM6Ly94',
    })
  })
  it('treats raw https URLs (Messenger CDN) as direct downloads', () => {
    expect(mediaSourceFromUrl('https://scontent.xx.fbcdn.net/a.jpg')).toEqual({
      kind: 'url',
      url: 'https://scontent.xx.fbcdn.net/a.jpg',
    })
  })
  it('ignores our own durable route and anything else', () => {
    expect(mediaSourceFromUrl(storedMediaRoute('abc'))).toBeNull()
    expect(mediaSourceFromUrl('http://insecure/x.jpg')).toBeNull()
    expect(mediaSourceFromUrl('/api/whatsapp/media/')).toBeNull()
  })
})
