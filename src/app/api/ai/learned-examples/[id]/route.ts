import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

type Params = { params: Promise<{ id: string }> }

/** PATCH /api/ai/learned-examples/[id]  (admin+) — { status: 'approved' | 'rejected' | 'pending' } */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const { id } = await params
    const body = await request.json().catch(() => null)
    const status = body?.status
    if (status !== 'approved' && status !== 'rejected' && status !== 'pending') {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }
    const { data, error } = await supabase
      .from('ai_learned_examples')
      .update({ status, reviewed_at: new Date().toISOString(), reviewed_by: userId })
      .eq('account_id', accountId)
      .eq('id', id)
      .select('id')
      .maybeSingle()
    if (error) return NextResponse.json({ error: 'Failed to update' }, { status: 500 })
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** DELETE /api/ai/learned-examples/[id]  (admin+) */
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { id } = await params
    const { error } = await supabase.from('ai_learned_examples').delete().eq('account_id', accountId).eq('id', id)
    if (error) return NextResponse.json({ error: 'Failed to delete' }, { status: 500 })
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
