import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const engineSendMediaMock = vi.fn()
vi.mock('@/lib/flows/meta-send', () => ({
  engineSendMedia: (...args: unknown[]) => engineSendMediaMock(...args),
}))

import { applySentMedia } from './media-actions'

function fakeDb(row: unknown, error: unknown = null): SupabaseClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: row, error }),
          }),
        }),
      }),
    }),
  } as unknown as SupabaseClient
}

const baseArgs = {
  accountId: 'acct-1',
  conversationId: 'conv-1',
  contactId: 'contact-1',
  configOwnerUserId: 'user-1',
  key: 'foto_llanta',
}

beforeEach(() => {
  engineSendMediaMock.mockReset()
})

describe('applySentMedia', () => {
  it('sends the matching catalog item, marked as AI-generated', async () => {
    engineSendMediaMock.mockResolvedValue({ whatsapp_message_id: 'wamid.1' })
    const db = fakeDb({ media_kind: 'image', media_url: 'https://example.com/tire.jpg' })

    await applySentMedia(db, baseArgs)

    expect(engineSendMediaMock).toHaveBeenCalledWith({
      accountId: 'acct-1',
      userId: 'user-1',
      conversationId: 'conv-1',
      contactId: 'contact-1',
      kind: 'image',
      link: 'https://example.com/tire.jpg',
      aiGenerated: true,
    })
  })

  it('does nothing when the model referenced an unknown key', async () => {
    const db = fakeDb(null)
    await applySentMedia(db, baseArgs)
    expect(engineSendMediaMock).not.toHaveBeenCalled()
  })

  it('swallows a lookup error rather than throwing', async () => {
    const db = fakeDb(null, { message: 'boom' })
    await expect(applySentMedia(db, baseArgs)).resolves.toBeUndefined()
    expect(engineSendMediaMock).not.toHaveBeenCalled()
  })

  it('swallows a send failure rather than throwing', async () => {
    engineSendMediaMock.mockRejectedValue(new Error('WhatsApp send failed'))
    const db = fakeDb({ media_kind: 'document', media_url: 'https://example.com/brochure.pdf' })
    await expect(applySentMedia(db, baseArgs)).resolves.toBeUndefined()
  })
})
