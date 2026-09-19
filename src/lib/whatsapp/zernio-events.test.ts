import { describe, expect, it } from 'vitest'
import { classifyZernioEvent } from './zernio-events'

describe('classifyZernioEvent', () => {
  it.each(['message.delivered', 'message.read', 'message.failed'])(
    'treats %s as a delivery status update',
    (event) => {
      expect(classifyZernioEvent({ event })).toBe('status')
    },
  )

  it('treats message.received as a conversation message', () => {
    expect(classifyZernioEvent({ event: 'message.received' })).toBe('message')
  })

  it('records a message.sent that came from the WhatsApp Business phone app', () => {
    expect(
      classifyZernioEvent({ event: 'message.sent', message: { source: 'whatsapp_business_app' } }),
    ).toBe('phone_sent')
  })

  it('ignores message.sent from the Cloud API — those are recorded by whoever sent them', () => {
    expect(classifyZernioEvent({ event: 'message.sent', message: { source: 'cloud_api' } })).toBe(
      'ignore',
    )
  })

  it('ignores message.sent with no source rather than guessing (e.g. other platforms)', () => {
    expect(classifyZernioEvent({ event: 'message.sent', message: {} })).toBe('ignore')
    expect(classifyZernioEvent({ event: 'message.sent', message: null })).toBe('ignore')
    expect(classifyZernioEvent({ event: 'message.sent' })).toBe('ignore')
  })

  it.each(['post.published', 'account.connected', 'reaction.received', '', undefined])(
    'ignores unrelated event %s',
    (event) => {
      expect(classifyZernioEvent({ event })).toBe('ignore')
    },
  )
})
