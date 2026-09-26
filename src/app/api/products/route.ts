import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { parseProduct } from '@/lib/quotes/products'

/**
 * GET  /api/products?q=llanta&all=1 — the catalog (active only unless
 *      all=1), name search, max 50. Any member.
 * POST /api/products — { name, sku?, description?, unitPrice } admin+.
 */
export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const url = new URL(request.url)
    const term = (url.searchParams.get('q') ?? '').replace(/[,()*%\\]/g, ' ').trim()
    let q = supabase
      .from('products')
      .select('id, name, sku, description, unit_price, is_active, updated_at')
      .eq('account_id', accountId)
      .order('name')
      .limit(url.searchParams.get('all') === '1' ? 500 : 50)
    if (url.searchParams.get('all') !== '1') q = q.eq('is_active', true)
    if (term) q = q.or(`name.ilike.%${term}%,sku.ilike.%${term}%`)
    const { data, error } = await q
    if (error) return NextResponse.json({ products: [], available: false })
    return NextResponse.json({ products: data ?? [], available: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const parsed = parseProduct(await request.json().catch(() => null), false)
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
    const { data, error } = await supabase
      .from('products')
      .insert({ ...parsed.value, account_id: accountId })
      .select('id, name, sku, description, unit_price, is_active, updated_at')
      .single()
    if (error) return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
    return NextResponse.json({ product: data })
  } catch (err) {
    return toErrorResponse(err)
  }
}
