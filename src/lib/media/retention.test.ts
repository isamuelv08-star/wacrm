import { describe, it, expect } from 'vitest'
import { planRetention } from './retention'

const base = { id: 'm1', media_url: null, media_storage_path: null }

describe('planRetention', () => {
  it('deletes an archived customer file', () => {
    expect(planRetention({ ...base, media_url: '/api/whatsapp/media/123', media_storage_path: 'acc/conv/m1.jpg' })).toEqual({
      action: 'delete',
      bucket: 'inbound-media',
      path: 'acc/conv/m1.jpg',
    })
  })

  it('deletes an advisor attachment from chat-media', () => {
    expect(
      planRetention({
        ...base,
        media_url: 'https://x.supabase.co/storage/v1/object/public/chat-media/account-1/1700000000-foto%201.jpg',
      }),
    ).toEqual({ action: 'delete', bucket: 'chat-media', path: 'account-1/1700000000-foto 1.jpg' })
  })

  it('clears an expired provider link with nothing stored', () => {
    expect(planRetention({ ...base, media_url: '/api/whatsapp/media/zernio/abc' })).toEqual({ action: 'clear' })
  })

  it('never touches reusable assets (flow media, AI library)', () => {
    expect(
      planRetention({ ...base, media_url: 'https://x.supabase.co/storage/v1/object/public/flow-media/account-1/a.png' }),
    ).toEqual({ action: 'keep' })
    expect(
      planRetention({ ...base, media_url: 'https://x.supabase.co/storage/v1/object/public/ai-media-library/a.pdf' }),
    ).toEqual({ action: 'keep' })
  })
})
