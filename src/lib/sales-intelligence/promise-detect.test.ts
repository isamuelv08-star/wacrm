import { describe, it, expect } from 'vitest'
import { looksLikePromise } from './promise-detect'

describe('looksLikePromise', () => {
  it('rejects empty/blank text without matching anything', () => {
    expect(looksLikePromise('')).toBe(false)
    expect(looksLikePromise('   ')).toBe(false)
  })

  it('matches common Spanish commitment phrases', () => {
    expect(looksLikePromise('Dale, te confirmo en 10 minutos')).toBe(true)
    expect(looksLikePromise('Mañana te mando el precio')).toBe(true)
    expect(looksLikePromise('Ahorita te aviso')).toBe(true)
    expect(looksLikePromise('Dame un momento y te escribo')).toBe(true)
    expect(looksLikePromise('En una hora te llamo')).toBe(true)
  })

  it('matches common English commitment phrases', () => {
    expect(looksLikePromise("I'll confirm in a bit")).toBe(true)
    expect(looksLikePromise('Give me a moment')).toBe(true)
    expect(looksLikePromise('in 15 minutes I will send it over')).toBe(true)
  })

  it('does not match ordinary conversational text with no commitment', () => {
    expect(looksLikePromise('Hola, ¿cómo estás?')).toBe(false)
    expect(looksLikePromise('El precio es de $500')).toBe(false)
    expect(looksLikePromise('Gracias por tu compra')).toBe(false)
  })

  it('is case-insensitive', () => {
    expect(looksLikePromise('TE CONFIRMO EN 5 MINUTOS')).toBe(true)
  })
})
