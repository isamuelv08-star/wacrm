import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole } from '@/lib/auth/account'
import { parseQuoteLines } from '@/lib/quotes/totals'
import { loadQuote, updateDraftQuote } from '@/lib/quotes/service'
import { quoteErrorResponse } from '@/lib/quotes/http'

type Params = { params: Promise<{ id: string }> }

/** GET /api/quotes/[id] — the quote with its lines. */
export async function GET(_request: Request, { params }: Params) {
  try {
    const { supabase } = await getCurrentAccount()
    const { id } = await params
    const quote = await loadQuote(supabase, id)
    if (!quote) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ quote })
  } catch (err) {
    return quoteErrorResponse(err)
  }
}

/**
 * PATCH /api/quotes/[id] (agent+)
 *   { lines, notes? }                     — edit a draft
 *   { status: 'accepted' | 'rejected' }   — record the customer's answer
 */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const { supabase } = await requireRole('agent')
    const { id } = await params
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null

    if (body?.status === 'accepted' || body?.status === 'rejected') {
      const { data, error } = await supabase
        .from('quotes')
        .update({ status: body.status, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select('id')
        .maybeSingle()
      if (error) return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
      if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      return NextResponse.json({ success: true })
    }

    const lines = parseQuoteLines(body?.lines)
    if (!lines) return NextResponse.json({ error: 'At least one valid line is required' }, { status: 400 })
    await updateDraftQuote(supabase, id, {
      lines,
      notes: typeof body?.notes === 'string' ? body.notes.slice(0, 2000) : null,
    })
    return NextResponse.json({ success: true })
  } catch (err) {
    return quoteErrorResponse(err)
  }
}

/** DELETE /api/quotes/[id] (admin+) */
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { supabase } = await requireRole('admin')
    const { id } = await params
    const { error } = await supabase.from('quotes').delete().eq('id', id)
    if (error) return NextResponse.json({ error: 'Failed to delete' }, { status: 500 })
    return NextResponse.json({ success: true })
  } catch (err) {
    return quoteErrorResponse(err)
  }
}
