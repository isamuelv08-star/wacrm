/**
 * Quote math — pure, unit-tested (totals.test.ts). Money is rounded to
 * cents at the line and at each total, the way a printed proforma adds
 * up.
 */

export interface QuoteLineInput {
  productId?: string | null
  description: string
  quantity: number
  unitPrice: number
  /** 0–100 */
  discountPct?: number
}

export interface QuoteTotals {
  /** Sum of the lines after their discounts, WITHOUT tax. */
  subtotal: number
  /** How much the line discounts took off (before tax). */
  discount: number
  tax: number
  total: number
  lineTotals: number[]
}

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

export function lineTotal(line: QuoteLineInput): number {
  const gross = line.quantity * line.unitPrice
  const pct = Math.min(100, Math.max(0, line.discountPct ?? 0))
  return round2(gross * (1 - pct / 100))
}

/**
 * `pricesIncludeTax`: the catalog prices already contain the tax (common
 * for retail) — the tax is then extracted from the total instead of
 * added on top.
 */
export function computeQuoteTotals(
  lines: QuoteLineInput[],
  taxRatePct: number,
  pricesIncludeTax: boolean,
): QuoteTotals {
  const lineTotals = lines.map(lineTotal)
  const sumLines = round2(lineTotals.reduce((s, n) => s + n, 0))
  const gross = round2(lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0))
  const rate = Math.max(0, taxRatePct) / 100

  let subtotal: number
  let tax: number
  let total: number
  if (pricesIncludeTax) {
    total = sumLines
    subtotal = round2(total / (1 + rate))
    tax = round2(total - subtotal)
  } else {
    subtotal = sumLines
    tax = round2(subtotal * rate)
    total = round2(subtotal + tax)
  }
  const discountGross = round2(gross - sumLines)
  const discount = pricesIncludeTax ? round2(discountGross / (1 + rate)) : discountGross
  return { subtotal, discount, tax, total, lineTotals }
}

/** Validate/normalize lines coming from a request body. */
export function parseQuoteLines(raw: unknown): QuoteLineInput[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 100) return null
  const out: QuoteLineInput[] = []
  for (const r of raw as Record<string, unknown>[]) {
    const description = typeof r?.description === 'string' ? r.description.trim().slice(0, 300) : ''
    const quantity = Number(r?.quantity)
    const unitPrice = Number(r?.unitPrice)
    const discountPct = r?.discountPct == null ? 0 : Number(r.discountPct)
    if (!description) return null
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000) return null
    if (!Number.isFinite(unitPrice) || unitPrice < 0 || unitPrice > 1_000_000_000) return null
    if (!Number.isFinite(discountPct) || discountPct < 0 || discountPct > 100) return null
    out.push({
      productId: typeof r?.productId === 'string' ? r.productId : null,
      description,
      quantity: round2(quantity),
      unitPrice: round2(unitPrice),
      discountPct: round2(discountPct),
    })
  }
  return out
}
