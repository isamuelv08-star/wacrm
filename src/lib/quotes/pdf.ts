import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'

/**
 * Render a quote (proforma) as an A4 PDF. Standard Helvetica — no font
 * files to ship — which covers Spanish/Portuguese accents (WinAnsi);
 * anything outside that (emoji, CJK) is dropped rather than failing.
 */

export interface QuotePdfInput {
  businessName: string
  number: string
  issuedAt: Date
  validUntil: string | null
  customerName: string
  customerPhone: string | null
  currency: string
  items: { description: string; quantity: number; unitPrice: number; discountPct: number; lineTotal: number }[]
  subtotal: number
  discount: number
  taxLabel: string
  taxRate: number
  tax: number
  total: number
  pricesIncludeTax: boolean
  notes: string | null
  terms: string | null
  labels: QuotePdfLabels
}

export interface QuotePdfLabels {
  title: string
  date: string
  validUntil: string
  customer: string
  phone: string
  description: string
  quantity: string
  unitPrice: string
  discount: string
  amount: string
  subtotal: string
  discounts: string
  total: string
  taxIncluded: string
  notes: string
  terms: string
}

const A4: [number, number] = [595.28, 841.89]
const MARGIN = 48
const INK = rgb(0.12, 0.13, 0.15)
const MUTED = rgb(0.42, 0.45, 0.5)
const LINE = rgb(0.86, 0.87, 0.9)
const ACCENT = rgb(0.13, 0.55, 0.33)

/** Keep only characters Helvetica (WinAnsi) can draw. */
export function pdfSafe(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/[^\x20-\x7E\xA0-\xFF\n]/g, '')
}

function money(n: number, currency: string): string {
  try {
    return new Intl.NumberFormat('es', { style: 'currency', currency, minimumFractionDigits: 2 }).format(n)
  } catch {
    return `${currency} ${n.toFixed(2)}`
  }
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = []
  for (const paragraph of pdfSafe(text).split('\n')) {
    let line = ''
    for (const word of paragraph.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word
      if (font.widthOfTextAtSize(next, size) <= width) line = next
      else {
        if (line) out.push(line)
        line = word
      }
    }
    out.push(line)
  }
  return out
}

export async function renderQuotePdf(q: QuotePdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle(`${q.labels.title} ${q.number}`)
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  let page: PDFPage = doc.addPage(A4)
  const [W, H] = A4
  let y = H - MARGIN

  const text = (s: string, x: number, yy: number, size = 10, f = font, color = INK) =>
    page.drawText(pdfSafe(s), { x, y: yy, size, font: f, color })
  const right = (s: string, xRight: number, yy: number, size = 10, f = font, color = INK) =>
    text(s, xRight - f.widthOfTextAtSize(pdfSafe(s), size), yy, size, f, color)
  const newPageIfNeeded = (need: number) => {
    if (y - need < MARGIN) {
      page = doc.addPage(A4)
      y = H - MARGIN
    }
  }

  // Header
  text(q.businessName, MARGIN, y, 16, bold)
  right(q.labels.title.toUpperCase(), W - MARGIN, y, 16, bold, ACCENT)
  y -= 20
  right(q.number, W - MARGIN, y, 11, bold)
  y -= 16
  right(`${q.labels.date}: ${q.issuedAt.toLocaleDateString('es')}`, W - MARGIN, y, 9, font, MUTED)
  if (q.validUntil) {
    y -= 12
    right(`${q.labels.validUntil}: ${new Date(q.validUntil + 'T12:00:00').toLocaleDateString('es')}`, W - MARGIN, y, 9, font, MUTED)
  }

  // Customer
  y -= 28
  text(q.labels.customer, MARGIN, y, 9, bold, MUTED)
  y -= 14
  text(q.customerName, MARGIN, y, 11, bold)
  if (q.customerPhone) {
    y -= 13
    text(`${q.labels.phone}: ${q.customerPhone}`, MARGIN, y, 9, font, MUTED)
  }

  // Items table
  const cols = { desc: MARGIN, qty: 330, price: 410, disc: 460, amount: W - MARGIN }
  const descWidth = cols.qty - cols.desc - 12
  y -= 28
  page.drawRectangle({ x: MARGIN - 6, y: y - 6, width: W - 2 * MARGIN + 12, height: 20, color: rgb(0.95, 0.96, 0.97) })
  text(q.labels.description, cols.desc, y, 9, bold, MUTED)
  right(q.labels.quantity, cols.qty + 30, y, 9, bold, MUTED)
  right(q.labels.unitPrice, cols.price + 40, y, 9, bold, MUTED)
  right(q.labels.discount, cols.disc + 40, y, 9, bold, MUTED)
  right(q.labels.amount, cols.amount, y, 9, bold, MUTED)
  y -= 22

  for (const item of q.items) {
    const lines = wrap(item.description, font, 10, descWidth)
    newPageIfNeeded(lines.length * 13 + 10)
    const top = y
    lines.forEach((l, i) => text(l, cols.desc, top - i * 13, 10))
    right(String(item.quantity), cols.qty + 30, top, 10)
    right(money(item.unitPrice, q.currency), cols.price + 40, top, 10)
    right(item.discountPct ? `${item.discountPct}%` : '-', cols.disc + 40, top, 10, font, MUTED)
    right(money(item.lineTotal, q.currency), cols.amount, top, 10, bold)
    y = top - lines.length * 13 - 6
    page.drawLine({ start: { x: MARGIN - 6, y: y + 2 }, end: { x: W - MARGIN + 6, y: y + 2 }, thickness: 0.5, color: LINE })
    y -= 10
  }

  // Totals
  newPageIfNeeded(100)
  y -= 6
  const labelX = cols.price - 20
  const row = (label: string, value: string, strong = false) => {
    text(label, labelX, y, strong ? 12 : 10, strong ? bold : font, strong ? INK : MUTED)
    right(value, cols.amount, y, strong ? 12 : 10, strong ? bold : font)
    y -= strong ? 18 : 15
  }
  row(q.labels.subtotal, money(q.subtotal, q.currency))
  if (q.discount > 0) row(q.labels.discounts, `-${money(q.discount, q.currency)}`)
  if (q.taxRate > 0) row(`${q.taxLabel} ${q.taxRate}%`, money(q.tax, q.currency))
  y -= 2
  page.drawLine({ start: { x: labelX, y: y + 12 }, end: { x: W - MARGIN, y: y + 12 }, thickness: 1, color: INK })
  row(q.labels.total, money(q.total, q.currency), true)
  if (q.pricesIncludeTax && q.taxRate > 0) {
    right(q.labels.taxIncluded, cols.amount, y, 8, font, MUTED)
    y -= 12
  }

  // Notes / terms
  for (const [label, body] of [
    [q.labels.notes, q.notes],
    [q.labels.terms, q.terms],
  ] as const) {
    if (!body?.trim()) continue
    const lines = wrap(body, font, 9, W - 2 * MARGIN)
    newPageIfNeeded(lines.length * 12 + 30)
    y -= 16
    text(label, MARGIN, y, 9, bold, MUTED)
    y -= 13
    for (const l of lines) {
      newPageIfNeeded(12)
      text(l, MARGIN, y, 9, font, INK)
      y -= 12
    }
  }

  return doc.save()
}
