import { NextResponse } from 'next/server'
import { getCurrentAccount } from '@/lib/auth/account'
import { loadQuote, renderQuote } from '@/lib/quotes/service'
import { quoteErrorResponse } from '@/lib/quotes/http'

type Params = { params: Promise<{ id: string }> }

/** GET /api/quotes/[id]/pdf — preview / download the PDF (rendered on the fly). */
export async function GET(_request: Request, { params }: Params) {
  try {
    const { supabase } = await getCurrentAccount()
    const { id } = await params
    const quote = await loadQuote(supabase, id)
    if (!quote) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const bytes = await renderQuote(supabase, quote)
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${quote.number}.pdf"`,
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (err) {
    return quoteErrorResponse(err)
  }
}
