import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Catalog products (migration 120) that match what the customer is
 * talking about — shown to the reply AI with their real prices, each
 * under a short code (P1, P2…) it echoes back in [[SEND_QUOTE: …]].
 */

export interface CatalogHit {
  code: string
  id: string
  name: string
  sku: string | null
  unitPrice: number
}

const MAX_HITS = 8
const STOPWORDS = new Set([
  'hola', 'buenas', 'buenos', 'dias', 'tardes', 'noches', 'gracias', 'favor', 'quiero', 'quisiera',
  'necesito', 'tienen', 'tiene', 'cuanto', 'cuesta', 'cuestan', 'precio', 'precios', 'valor', 'para',
  'como', 'esta', 'este', 'estos', 'estas', 'unas', 'unos', 'porfa', 'info', 'informacion', 'saber',
  'cotizacion', 'cotizar', 'proforma', 'please', 'price', 'much', 'with', 'have', 'need', 'want',
])

/** Search tokens: numbers / sizes ("205", "r16") and meaningful words. Pure — tested. */
export function catalogTokens(text: string): string[] {
  const words = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
  const out: string[] = []
  for (const w of words) {
    const hasDigit = /\d/.test(w)
    if (hasDigit ? w.length < 2 : w.length < 4) continue
    if (STOPWORDS.has(w)) continue
    if (!out.includes(w)) out.push(w)
    if (out.length >= 10) break
  }
  return out
}

export async function findCatalogProducts(
  db: SupabaseClient,
  accountId: string,
  customerText: string,
): Promise<CatalogHit[]> {
  const tokens = catalogTokens(customerText)
  if (!tokens.length) return []
  try {
    const { data, error } = await db
      .from('products')
      .select('id, name, sku, unit_price')
      .eq('account_id', accountId)
      .eq('is_active', true)
      .or(tokens.map((t) => `name.ilike.%${t}%,sku.ilike.%${t}%`).join(','))
      .limit(60)
    if (error || !data?.length) return []
    const scored = (data as { id: string; name: string; sku: string | null; unit_price: number }[])
      .map((p) => {
        const hay = `${p.name} ${p.sku ?? ''}`
          .toLowerCase()
          .normalize('NFD')
          .replace(/[̀-ͯ]/g, '')
        // "55r16" must match "205/55 R16": compare spaceless too.
        const compact = hay.replace(/[^a-z0-9]/g, '')
        return { p, score: tokens.filter((t) => hay.includes(t) || compact.includes(t)).length }
      })
      .sort((a, b) => b.score - a.score || a.p.name.localeCompare(b.p.name))
    const best = scored[0]?.score ?? 0
    // Keep the closest matches only: a product matching 3 of the size's
    // tokens beats 20 that only share "michelin".
    return scored
      .filter((s) => s.score >= Math.max(1, best - 1))
      .slice(0, MAX_HITS)
      .map((s, i) => ({ code: `P${i + 1}`, id: s.p.id, name: s.p.name, sku: s.p.sku, unitPrice: Number(s.p.unit_price) }))
  } catch {
    return []
  }
}

export interface QuoteRequestItem {
  code: string
  quantity: number
}

/** Parse the inside of [[SEND_QUOTE: P1 x 4; P2 x 1]]. Pure — tested. */
export function parseQuoteRequest(inner: string): QuoteRequestItem[] {
  const out: QuoteRequestItem[] = []
  for (const m of inner.matchAll(/P(\d{1,2})\s*[x×*]\s*(\d+(?:[.,]\d+)?)/gi)) {
    const quantity = Number(m[2].replace(',', '.'))
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 10_000) continue
    const code = `P${Number(m[1])}`
    const existing = out.find((i) => i.code === code)
    if (existing) existing.quantity += quantity
    else out.push({ code, quantity })
  }
  return out.slice(0, 20)
}

export interface CatalogContext {
  items: CatalogHit[]
  currency: string
  taxNote: string | null
}

/**
 * Catalog matches for the customer's recent messages plus how to read
 * the prices (currency, tax). Null when nothing matches or the account
 * has no catalog (or before migration 120).
 */
export async function loadCatalogContext(
  db: SupabaseClient,
  accountId: string,
  recentCustomerText: string,
): Promise<CatalogContext | null> {
  const items = await findCatalogProducts(db, accountId, recentCustomerText)
  if (!items.length) return null
  const { data } = await db
    .from('accounts')
    .select('default_currency, quote_tax_label, quote_tax_rate, quote_prices_include_tax')
    .eq('id', accountId)
    .maybeSingle()
  const rate = Number(data?.quote_tax_rate ?? 0)
  const label = (data?.quote_tax_label as string | undefined) || 'tax'
  const taxNote =
    rate > 0
      ? data?.quote_prices_include_tax
        ? `prices include ${label} ${rate}%`
        : `${label} ${rate}% is added on top of these prices`
      : null
  return { items, currency: ((data?.default_currency as string | undefined) || 'USD').toUpperCase(), taxNote }
}
