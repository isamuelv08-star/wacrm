import { describe, expect, it } from 'vitest'
import {
  buildObserverPrompt,
  buildObserverTranscript,
  parseObservation,
  type ObserverContext,
} from './observer'

function ctx(overrides: Partial<ObserverContext> = {}): ObserverContext {
  return {
    userPrompt: null,
    salesMode: null,
    hasOpenDeal: false,
    needsContactName: true,
    nowLabel: null,
    ...overrides,
  }
}

describe('buildObserverPrompt', () => {
  it('only asks for the contact name when there is no deal to drive', () => {
    const prompt = buildObserverPrompt(ctx())
    expect(prompt).toContain('"contactName"')
    expect(prompt).not.toContain('"stage"')
    expect(prompt).not.toContain('"summary"')
    expect(prompt).not.toContain('"appointment"')
  })

  it('asks for the summary once there is an open deal, and stages only in sales mode', () => {
    const withDeal = buildObserverPrompt(ctx({ hasOpenDeal: true, needsContactName: false }))
    expect(withDeal).toContain('"summary"')
    expect(withDeal).not.toContain('"stage"')

    const withSales = buildObserverPrompt(
      ctx({
        hasOpenDeal: true,
        needsContactName: false,
        salesMode: {
          stages: [
            { name: 'Nuevo', current: true },
            { name: 'Negociación', current: false },
          ],
          currency: 'usd',
        },
      }),
    )
    expect(withSales).toContain('"stage"')
    expect(withSales).toContain('- Nuevo (current stage)')
    expect(withSales).toContain('USD')
  })

  it('asks for an appointment only when scheduling is on, anchored to the account clock', () => {
    const prompt = buildObserverPrompt(ctx({ nowLabel: 'Monday, 22 September 2026, 15:04' }))
    expect(prompt).toContain('"appointment"')
    expect(prompt).toContain('Monday, 22 September 2026, 15:04')
  })

  // The whole point of the mode: it reads, it never writes to the customer.
  it('tells the model it never writes to the customer', () => {
    expect(buildObserverPrompt(ctx())).toContain('NEVER write to the customer')
  })
})

describe('buildObserverTranscript', () => {
  it('labels each turn by side, oldest first', () => {
    const transcript = buildObserverTranscript([
      { role: 'user', content: '¿Tienen llantas 195/65?' },
      { role: 'assistant', content: 'Sí, a $65 cada una' },
    ])
    expect(transcript).toContain('Customer: ¿Tienen llantas 195/65?')
    expect(transcript).toContain('Business: Sí, a $65 cada una')
    expect(transcript.indexOf('Customer:')).toBeLessThan(transcript.indexOf('Business:'))
  })
})

describe('parseObservation', () => {
  it('reads a full observation', () => {
    const seen = parseObservation(
      JSON.stringify({
        contactName: 'María Pérez',
        summary: 'Quiere 4 llantas, pide factura',
        stage: 'Negociación',
        dealStatus: 'won',
        dealValue: 260.5,
        appointment: { dateTime: '2026-09-23T10:00', type: 'meeting', title: 'Montaje' },
      }),
    )
    expect(seen).toEqual({
      contactName: 'María Pérez',
      summary: 'Quiere 4 llantas, pide factura',
      stage: 'Negociación',
      dealStatus: 'won',
      dealValue: 260.5,
      appointment: { localDateTime: '2026-09-23T10:00', type: 'meeting', title: 'Montaje' },
    })
  })

  it('reads through a markdown code fence', () => {
    const seen = parseObservation('```json\n{"contactName":"Ana"}\n```')
    expect(seen.contactName).toBe('Ana')
  })

  it('treats malformed output as "nothing observed" rather than guessing', () => {
    expect(parseObservation('sorry, I cannot help with that')).toEqual({
      contactName: null,
      summary: null,
      stage: null,
      dealStatus: null,
      dealValue: null,
      appointment: null,
    })
  })

  it('drops an invalid deal status and a negative value', () => {
    const seen = parseObservation(
      JSON.stringify({ dealStatus: 'maybe', dealValue: -10 }),
    )
    expect(seen.dealStatus).toBeNull()
    expect(seen.dealValue).toBeNull()
  })

  it('accepts a numeric string value and rounds to cents', () => {
    expect(parseObservation(JSON.stringify({ dealValue: '99.456' })).dealValue).toBe(99.46)
  })

  // A half-parsed appointment would put a wrong date on someone's
  // calendar, so every field has to be exactly right or it's dropped.
  it.each([
    ['a loose date', { dateTime: 'tomorrow at 10', type: 'call', title: 'Llamada' }],
    ['a date with an offset', { dateTime: '2026-09-23T10:00:00Z', type: 'call', title: 'Llamada' }],
    ['an unknown type', { dateTime: '2026-09-23T10:00', type: 'lunch', title: 'Almuerzo' }],
    ['no title', { dateTime: '2026-09-23T10:00', type: 'call', title: '  ' }],
    ['not an object', 'tomorrow'],
  ])('drops an appointment with %s', (_label, appointment) => {
    expect(parseObservation(JSON.stringify({ appointment })).appointment).toBeNull()
  })
})
