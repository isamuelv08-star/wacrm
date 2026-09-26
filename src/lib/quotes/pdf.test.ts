import { describe, it, expect } from 'vitest'
import { pdfSafe, renderQuotePdf } from './pdf'

const labels = {
  title: 'Cotización', date: 'Fecha', validUntil: 'Válida hasta', customer: 'Cliente', phone: 'Teléfono',
  description: 'Descripción', quantity: 'Cant.', unitPrice: 'P. unit.', discount: 'Desc.', amount: 'Importe',
  subtotal: 'Subtotal', discounts: 'Descuentos', total: 'Total', taxIncluded: 'Precios con IVA incluido',
  notes: 'Notas', terms: 'Condiciones',
}

describe('renderQuotePdf', () => {
  it('renders a PDF with accents, long descriptions and many lines', async () => {
    const bytes = await renderQuotePdf({
      businessName: 'Mundillantas', number: 'COT-000001', issuedAt: new Date('2026-09-26T12:00:00Z'),
      validUntil: '2026-10-11', customerName: 'José Peña 🚗', customerPhone: '+593991234567', currency: 'USD',
      items: Array.from({ length: 60 }, (_, i) => ({
        description: `Llanta 205/55 R16 línea ${i} — con instalación, balanceo y válvula nueva incluida en el precio`,
        quantity: 4, unitPrice: 85, discountPct: i % 2 ? 10 : 0, lineTotal: 340,
      })),
      subtotal: 350, discount: 10, taxLabel: 'IVA', taxRate: 15, tax: 52.5, total: 402.5,
      pricesIncludeTax: false, notes: 'Entrega inmediata.', terms: 'Pago por transferencia.\nGarantía 1 año.', labels,
    })
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe('%PDF-')
    expect(bytes.byteLength).toBeGreaterThan(1000)
  })

  it('drops characters Helvetica cannot draw', () => {
    expect(pdfSafe('Hola 👋 “Juan” – ñandú')).toBe('Hola  "Juan" - ñandú')
  })
})
