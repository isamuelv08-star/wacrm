import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { parseProduct } from '@/lib/quotes/products'

type Params = { params: Promise<{ id: string }> }

/** PATCH /api/products/[id] (admin+) */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { id } = await params
    const parsed = parseProduct(await request.json().catch(() => null), true)
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
    const { data, error } = await supabase
      .from('products')
      .update({ ...parsed.value, updated_at: new Date().toISOString() })
      .eq('account_id', accountId)
      .eq('id', id)
      .select('id, name, sku, description, unit_price, is_active, updated_at')
      .maybeSingle()
    if (error) return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ product: data })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** DELETE /api/products/[id] (admin+) — past quotes keep their copied lines. */
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { id } = await params
    const { error } = await supabase.from('products').delete().eq('account_id', accountId).eq('id', id)
    if (error) return NextResponse.json({ error: 'Failed to delete' }, { status: 500 })
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
