import { describe, expect, it } from 'vitest'
import {
  buildLeadSummarySystemPrompt,
  buildLeadSummaryUserMessage,
  buildTranscript,
  isSummaryFresh,
  languageName,
  parseLeadSummary,
  type LeadSummaryFacts,
  type TranscriptRow,
} from './lead-summary'

const emptyFacts: LeadSummaryFacts = {
  name: null,
  score: null,
  scoreReason: null,
  need: null,
  budget: null,
  objection: null,
  productInterest: null,
  deals: [],
  tags: [],
  pendingPromises: [],
}

const row = (over: Partial<TranscriptRow>): TranscriptRow => ({
  sender_type: 'customer',
  content_type: 'text',
  content_text: 'hola',
  created_at: '2026-09-19T10:00:00Z',
  ...over,
})

describe('parseLeadSummary', () => {
  it('parses a well-formed response', () => {
    const out = parseLeadSummary(
      JSON.stringify({
        summary: 'Cliente quiere 4 llantas 205/55R16.',
        highlights: ['Presupuesto: $400', 'Urgente esta semana'],
        nextStep: 'Enviar cotización hoy',
      }),
    )
    expect(out).toEqual({
      summary: 'Cliente quiere 4 llantas 205/55R16.',
      highlights: ['Presupuesto: $400', 'Urgente esta semana'],
      nextStep: 'Enviar cotización hoy',
    })
  })

  it('tolerates a ```json fence around the JSON', () => {
    const out = parseLeadSummary('```json\n{"summary":"Ok","highlights":[],"nextStep":null}\n```')
    expect(out?.summary).toBe('Ok')
  })

  it('caps highlights at 4 and drops blank / non-string entries', () => {
    const out = parseLeadSummary(
      JSON.stringify({
        summary: 'x',
        highlights: ['a', '  ', 3, 'b', 'c', 'd', 'e'],
      }),
    )
    expect(out?.highlights).toEqual(['a', 'b', 'c', 'd'])
  })

  it('defaults missing optional fields', () => {
    const out = parseLeadSummary(JSON.stringify({ summary: 'Solo resumen' }))
    expect(out).toEqual({ summary: 'Solo resumen', highlights: [], nextStep: null })
  })

  it.each([
    ['not json', 'lo siento, no puedo'],
    ['an array', '[1,2]'],
    ['a blank summary', JSON.stringify({ summary: '   ' })],
    ['a non-string summary', JSON.stringify({ summary: 42 })],
    ['null', 'null'],
  ])('returns null for %s', (_label, raw) => {
    expect(parseLeadSummary(raw)).toBeNull()
  })

  it('truncates an over-long summary instead of storing it whole', () => {
    const out = parseLeadSummary(JSON.stringify({ summary: 'a'.repeat(5000) }))
    expect(out!.summary.length).toBeLessThanOrEqual(1200)
  })
})

describe('isSummaryFresh', () => {
  const cached = { source_message_id: 'm2', language: 'es' }

  it('is fresh only for the same newest message and language', () => {
    expect(isSummaryFresh(cached, 'm2', 'es')).toBe(true)
  })

  it('is stale when a newer message exists', () => {
    expect(isSummaryFresh(cached, 'm3', 'es')).toBe(false)
  })

  it('is stale when the UI language changed', () => {
    expect(isSummaryFresh(cached, 'm2', 'en')).toBe(false)
  })

  it('is stale when nothing is cached', () => {
    expect(isSummaryFresh(null, 'm2', 'es')).toBe(false)
  })
})

describe('buildTranscript', () => {
  it('orders oldest first and labels speakers', () => {
    // Input is newest-first, as the route fetches it.
    const text = buildTranscript([
      row({ sender_type: 'agent', content_text: 'Claro, te cotizo' }),
      row({ sender_type: 'customer', content_text: 'Necesito llantas' }),
    ])
    expect(text).toBe('Customer: Necesito llantas\nSeller: Claro, te cotizo')
  })

  it('drops rows with no usable text', () => {
    const text = buildTranscript([
      row({ content_type: 'image', content_text: null, ai_image_description: null }),
      row({ content_text: 'hola' }),
    ])
    expect(text).toBe('Customer: hola')
  })

  it('collapses whitespace and truncates very long messages', () => {
    const text = buildTranscript([row({ content_text: `a\n\nb  ${'z'.repeat(900)}` })])
    expect(text.startsWith('Customer: a b zzz')).toBe(true)
    expect(text.endsWith('…')).toBe(true)
    expect(text.length).toBeLessThan(560)
  })

  it('keeps only the most recent 60 lines', () => {
    const rows = Array.from({ length: 80 }, (_, i) => row({ content_text: `msg ${79 - i}` }))
    const lines = buildTranscript(rows).split('\n')
    expect(lines).toHaveLength(60)
    expect(lines[0]).toBe('Customer: msg 20')
    expect(lines[59]).toBe('Customer: msg 79')
  })
})

describe('buildLeadSummaryUserMessage', () => {
  it('lists only the facts that are known', () => {
    const msg = buildLeadSummaryUserMessage(
      { ...emptyFacts, need: 'Llantas para taxi', budget: '$400', tags: ['Meta Ads'] },
      'Customer: hola',
    )
    expect(msg).toContain('- Stated need: Llantas para taxi')
    expect(msg).toContain('- Stated budget: $400')
    expect(msg).toContain('- Tags: Meta Ads')
    expect(msg).not.toContain('Stated objection')
    expect(msg).toContain('Customer: hola')
  })

  it('renders deals and pending commitments', () => {
    const msg = buildLeadSummaryUserMessage(
      {
        ...emptyFacts,
        deals: [{ title: 'Juego de 4', stage: 'Cotizado', value: 380, currency: 'USD', status: 'open' }],
        pendingPromises: ['Enviar cotización mañana'],
      },
      '',
    )
    expect(msg).toContain('- Deal: Juego de 4 (stage: Cotizado) [open] — 380 USD')
    expect(msg).toContain('- Pending commitment by the business: Enviar cotización mañana')
    expect(msg).toContain('(no text messages)')
  })

  it('says so when nothing is recorded yet', () => {
    expect(buildLeadSummaryUserMessage(emptyFacts, 'Customer: hi')).toContain('- (none recorded yet)')
  })
})

describe('language handling', () => {
  it('names known locales and falls back to English', () => {
    expect(languageName('es')).toBe('Spanish')
    expect(languageName('ko')).toBe('Korean')
    expect(languageName('fr')).toBe('English')
  })

  it('asks the model to answer in that language and forbids inventing facts', () => {
    const prompt = buildLeadSummarySystemPrompt('Spanish')
    expect(prompt).toContain('Write every string in Spanish')
    expect(prompt).toContain('Never invent')
    expect(prompt).toContain('NOT talking to the customer')
  })
})
