/** Validate a product body from the catalog API (create: all fields; update: partial). */
export function parseProduct(body: Record<string, unknown> | null, partial: boolean) {
  const out: Record<string, unknown> = {}
  if (!body) return { error: 'Invalid body' }
  if ('name' in body || !partial) {
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 200) : ''
    if (!name) return { error: "'name' is required" }
    out.name = name
  }
  if ('sku' in body) out.sku = typeof body.sku === 'string' && body.sku.trim() ? body.sku.trim().slice(0, 80) : null
  if ('description' in body)
    out.description =
      typeof body.description === 'string' && body.description.trim() ? body.description.trim().slice(0, 1000) : null
  if ('unitPrice' in body || !partial) {
    const price = Number(body.unitPrice)
    if (!Number.isFinite(price) || price < 0 || price > 1_000_000_000) return { error: "'unitPrice' must be >= 0" }
    out.unit_price = Math.round(price * 100) / 100
  }
  if ('isActive' in body) out.is_active = body.isActive !== false
  return { value: out }
}
