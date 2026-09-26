import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'

const COLUMNS =
  'default_currency, quote_tax_label, quote_tax_rate, quote_prices_include_tax, quote_validity_days, quote_terms, quote_prefix'

/** GET /api/account/quote-settings — any member. */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const { data, error } = await supabase.from('accounts').select(COLUMNS).eq('id', accountId).maybeSingle()
    if (error) return NextResponse.json({ available: false })
    return NextResponse.json({ available: true, settings: data })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** PATCH /api/account/quote-settings — admin+. */
export async function PATCH(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const b = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!b) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
    const update: Record<string, unknown> = {}
    if ('taxLabel' in b) {
      const v = typeof b.taxLabel === 'string' ? b.taxLabel.trim().slice(0, 20) : ''
      if (!v) return NextResponse.json({ error: "'taxLabel' is required" }, { status: 400 })
      update.quote_tax_label = v
    }
    if ('taxRate' in b) {
      const v = Number(b.taxRate)
      if (!Number.isFinite(v) || v < 0 || v > 100) {
        return NextResponse.json({ error: "'taxRate' must be 0-100" }, { status: 400 })
      }
      update.quote_tax_rate = Math.round(v * 100) / 100
    }
    if ('pricesIncludeTax' in b) update.quote_prices_include_tax = b.pricesIncludeTax === true
    if ('validityDays' in b) {
      const v = Number(b.validityDays)
      if (!Number.isInteger(v) || v < 1 || v > 365) {
        return NextResponse.json({ error: "'validityDays' must be 1-365" }, { status: 400 })
      }
      update.quote_validity_days = v
    }
    if ('terms' in b) {
      update.quote_terms = typeof b.terms === 'string' && b.terms.trim() ? b.terms.trim().slice(0, 3000) : null
    }
    if ('prefix' in b) {
      const v =
        typeof b.prefix === 'string' ? b.prefix.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 10) : ''
      if (!v) return NextResponse.json({ error: "'prefix' is required" }, { status: 400 })
      update.quote_prefix = v
    }
    if (!Object.keys(update).length) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
    const { error } = await supabase.from('accounts').update(update).eq('id', accountId)
    if (error) return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
