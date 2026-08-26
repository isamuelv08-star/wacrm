import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { buildConversationContext } from './context'

/** Minimal fake matching the query chain in buildConversationContext:
 *  from().select().eq().in().order().limit() → { data, error }. */
function fakeDb(rows: unknown[]): SupabaseClient {
  const chain = {
    from: () => chain,
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    order: () => chain,
    limit: () => Promise.resolve({ data: rows, error: null }),
  }
  return chain as unknown as SupabaseClient
}

describe('buildConversationContext', () => {
  it('maps sender_type to role and returns chronological order', async () => {
    // DB returns newest-first (created_at DESC); the fn reverses it.
    const rows = [
      { sender_type: 'customer', content_text: 'third' },
      { sender_type: 'agent', content_text: 'second' },
      { sender_type: 'customer', content_text: 'first' },
    ]
    const out = await buildConversationContext(fakeDb(rows), 'conv-1')
    expect(out).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'second' },
      { role: 'user', content: 'third' },
    ])
  })

  it('treats bot messages as assistant', async () => {
    const out = await buildConversationContext(
      fakeDb([{ sender_type: 'bot', content_text: 'auto reply' }]),
      'conv-1',
    )
    expect(out).toEqual([{ role: 'assistant', content: 'auto reply' }])
  })

  it('drops empty / whitespace-only messages', async () => {
    const out = await buildConversationContext(
      fakeDb([
        { sender_type: 'customer', content_text: '   ' },
        { sender_type: 'customer', content_text: null },
        { sender_type: 'customer', content_text: 'real' },
      ]),
      'conv-1',
    )
    expect(out).toEqual([{ role: 'user', content: 'real' }])
  })

  it('includes a transcribed voice note like any other customer message', async () => {
    const out = await buildConversationContext(
      fakeDb([
        { sender_type: 'customer', content_text: 'transcribed voice note' },
      ]),
      'conv-1',
    )
    expect(out).toEqual([{ role: 'user', content: 'transcribed voice note' }])
  })

  it('combines an image caption with its AI description', async () => {
    const out = await buildConversationContext(
      fakeDb([
        {
          sender_type: 'customer',
          content_type: 'image',
          content_text: 'it arrived like this',
          ai_image_description: 'A cracked phone screen.',
        },
      ]),
      'conv-1',
    )
    expect(out).toEqual([
      { role: 'user', content: 'it arrived like this\nA cracked phone screen.' },
    ])
  })

  it('falls back to just the description for a captionless image', async () => {
    const out = await buildConversationContext(
      fakeDb([
        {
          sender_type: 'customer',
          content_type: 'image',
          content_text: null,
          ai_image_description: 'A red hoodie with a $45 price tag.',
        },
      ]),
      'conv-1',
    )
    expect(out).toEqual([{ role: 'user', content: 'A red hoodie with a $45 price tag.' }])
  })

  it('drops an image with neither a caption nor a description yet', async () => {
    const out = await buildConversationContext(
      fakeDb([
        { sender_type: 'customer', content_type: 'image', content_text: null, ai_image_description: null },
      ]),
      'conv-1',
    )
    expect(out).toEqual([])
  })

  it('includes a captioned video, tagged so the model knows it was a video', async () => {
    const out = await buildConversationContext(
      fakeDb([
        { sender_type: 'customer', content_type: 'video', content_text: 'is this in stock?' },
      ]),
      'conv-1',
    )
    expect(out).toEqual([{ role: 'user', content: '[Video] is this in stock?' }])
  })

  it('falls back to a plain marker for a captionless video', async () => {
    const out = await buildConversationContext(
      fakeDb([{ sender_type: 'customer', content_type: 'video', content_text: null }]),
      'conv-1',
    )
    expect(out).toEqual([{ role: 'user', content: '[Customer sent a video]' }])
  })

  it('falls back to a plain marker for a voice note with no transcript', async () => {
    const out = await buildConversationContext(
      fakeDb([{ sender_type: 'customer', content_type: 'audio', content_text: null }]),
      'conv-1',
    )
    expect(out).toEqual([
      { role: 'user', content: '[Customer sent a voice message; no transcript available]' },
    ])
  })

  it('never drops a video or an untranscribed voice note from context', async () => {
    // Unlike text/image, these must never disappear entirely — the
    // whole point of the marker fallback is that the model still
    // knows *something* arrived even without understanding it.
    const out = await buildConversationContext(
      fakeDb([
        { sender_type: 'customer', content_type: 'video', content_text: null },
        { sender_type: 'customer', content_type: 'audio', content_text: null },
      ]),
      'conv-1',
    )
    expect(out).toHaveLength(2)
  })
})
