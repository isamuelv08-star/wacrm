import { describe, it, expect } from 'vitest'
import { advisorReplyFrom, anonymize, customerTurnBefore, type ThreadRow } from './core'

const row = (sender_type: ThreadRow['sender_type'], content_text: string, created_at: string): ThreadRow => ({
  sender_type,
  content_type: 'text',
  content_text,
  created_at,
})

describe('anonymize', () => {
  it('removes emails, phone numbers and the customer name, keeps tyre sizes and prices', () => {
    const out = anonymize(
      'Hola Juan Pérez, te escribo al 0991234567 o juan@mail.com. La 205/55 R16 cuesta $85.',
      'Juan Pérez',
    )
    expect(out).toBe('Hola [cliente] [cliente], te escribo al [número] o [email]. La 205/55 R16 cuesta $85.')
  })
  it('does not treat a phone-number "name" as a name', () => {
    expect(anonymize('ok 593991234567', '+593991234567')).toBe('ok [número]')
  })
})

describe('customerTurnBefore', () => {
  const at = '2026-09-25T10:05:00Z'
  it('joins the consecutive customer messages the advisor answered', () => {
    const before = [
      row('customer', 'para un corolla 2015', '2026-09-25T10:01:00Z'),
      row('customer', 'cuánto cuestan 4 llantas?', '2026-09-25T10:00:00Z'),
      row('agent', 'hola', '2026-09-25T09:00:00Z'),
    ]
    expect(customerTurnBefore(before, at)).toBe('cuánto cuestan 4 llantas?\npara un corolla 2015')
  })
  it('skips a reply that did not follow a customer message', () => {
    expect(customerTurnBefore([row('agent', 'x', '2026-09-25T10:00:00Z')], at)).toBeNull()
  })
  it('skips a reply to a customer message from days ago', () => {
    expect(customerTurnBefore([row('customer', 'precio llantas', '2026-09-20T10:00:00Z')], at)).toBeNull()
  })
})

describe('advisorReplyFrom', () => {
  it('merges the advisor bubbles sent right after', () => {
    const after = [
      row('agent', 'Las 205/55 R16 están a $85 c/u instaladas.', '2026-09-25T10:06:00Z'),
      row('customer', 'ok', '2026-09-25T10:07:00Z'),
    ]
    expect(advisorReplyFrom('Hola, claro que sí', after, '2026-09-25T10:05:00Z')).toBe(
      'Hola, claro que sí\nLas 205/55 R16 están a $85 c/u instaladas.',
    )
  })
  it('drops greeting-only or too short replies', () => {
    expect(advisorReplyFrom('Buenas tardes!', [], '2026-09-25T10:05:00Z')).toBeNull()
    expect(advisorReplyFrom('ok', [], '2026-09-25T10:05:00Z')).toBeNull()
  })
})
