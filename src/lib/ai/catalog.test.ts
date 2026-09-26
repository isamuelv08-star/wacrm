import { describe, it, expect } from 'vitest'
import { catalogTokens, parseQuoteRequest } from './catalog'
import { parseGeneration } from './generate'
import { buildSystemPrompt } from './defaults'

describe('catalogTokens', () => {
  it('keeps sizes and meaningful words, drops filler and accents', () => {
    expect(catalogTokens('Hola, ¿cuánto cuestan 4 llantas 205/55R16 Michelín para mi carro?')).toEqual([
      'llantas',
      '205',
      '55r16',
      'michelin',
      'carro',
    ])
  })
})

describe('parseQuoteRequest', () => {
  it('reads codes and quantities, merging repeats', () => {
    expect(parseQuoteRequest('P1 x 4; P3 x1, p1 × 2')).toEqual([
      { code: 'P1', quantity: 6 },
      { code: 'P3', quantity: 1 },
    ])
  })
  it('ignores garbage', () => {
    expect(parseQuoteRequest('four tires please')).toEqual([])
    expect(parseQuoteRequest('P2 x 0')).toEqual([])
  })
})


describe('SEND_QUOTE end to end', () => {
  it('is parsed and never reaches the customer', () => {
    const r = parseGeneration('Listo, te envío la cotización ahora mismo. [[SEND_QUOTE: P1 x 4; P2 x 1]]')
    expect(r.sendQuote).toBe('P1 x 4; P2 x 1')
    expect(r.text).toBe('Listo, te envío la cotización ahora mismo.')
  })

  it('is only taught when quotes are enabled, and prices are always listed', () => {
    const catalog = {
      items: [{ code: 'P1', name: 'Llanta 205/55 R16', sku: 'MI-20555', unitPrice: 85 }],
      currency: 'USD',
      taxNote: 'IVA 15% is added on top of these prices',
    }
    const off = buildSystemPrompt({ userPrompt: null, mode: 'auto_reply', catalog: { ...catalog, canSendQuotes: false } })
    expect(off).toContain('P1: Llanta 205/55 R16 [MI-20555] — $85.00')
    expect(off).not.toContain('[[SEND_QUOTE')
    const on = buildSystemPrompt({ userPrompt: null, mode: 'auto_reply', catalog: { ...catalog, canSendQuotes: true } })
    expect(on).toContain('[[SEND_QUOTE: P1 x 4; P2 x 1]]')
    const draft = buildSystemPrompt({ userPrompt: null, mode: 'draft', catalog: { ...catalog, canSendQuotes: true } })
    expect(draft).not.toContain('[[SEND_QUOTE')
  })
})
