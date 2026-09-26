import { describe, it, expect } from 'vitest'
import { computeQuoteTotals, lineTotal, parseQuoteLines } from './totals'

describe('quote totals', () => {
  it('adds tax on top of the prices', () => {
    const t = computeQuoteTotals(
      [
        { description: 'Llanta 205/55 R16', quantity: 4, unitPrice: 85 },
        { description: 'Alineación', quantity: 1, unitPrice: 20, discountPct: 50 },
      ],
      15,
      false,
    )
    expect(t.lineTotals).toEqual([340, 10])
    expect(t.subtotal).toBe(350)
    expect(t.discount).toBe(10)
    expect(t.tax).toBe(52.5)
    expect(t.total).toBe(402.5)
  })

  it('extracts tax when prices already include it', () => {
    const t = computeQuoteTotals([{ description: 'Llanta', quantity: 1, unitPrice: 115 }], 15, true)
    expect(t.total).toBe(115)
    expect(t.subtotal).toBe(100)
    expect(t.tax).toBe(15)
  })

  it('works with no tax', () => {
    const t = computeQuoteTotals([{ description: 'x', quantity: 3, unitPrice: 9.99 }], 0, false)
    expect(t.total).toBe(29.97)
    expect(t.tax).toBe(0)
  })

  it('rounds each line to cents', () => {
    expect(lineTotal({ description: 'x', quantity: 3, unitPrice: 0.333 })).toBe(1)
  })
})

describe('parseQuoteLines', () => {
  it('accepts valid lines and rejects bad ones', () => {
    expect(parseQuoteLines([{ description: ' A ', quantity: '2', unitPrice: 10 }])).toEqual([
      { productId: null, description: 'A', quantity: 2, unitPrice: 10, discountPct: 0 },
    ])
    expect(parseQuoteLines([])).toBeNull()
    expect(parseQuoteLines([{ description: 'A', quantity: 0, unitPrice: 10 }])).toBeNull()
    expect(parseQuoteLines([{ description: '', quantity: 1, unitPrice: 10 }])).toBeNull()
    expect(parseQuoteLines([{ description: 'A', quantity: 1, unitPrice: -1 }])).toBeNull()
  })
})
