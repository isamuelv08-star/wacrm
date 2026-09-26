import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { supabaseAdmin } from '@/lib/notifications/admin-client'
import { parseQuoteLines } from '@/lib/quotes/totals'
import { createQuote, sendQuote } from '@/lib/quotes/service'
import { quoteErrorResponse } from '@/lib/quotes/http'

/**
 * GET  /api/quotes?contact_id=… — a contact's quotes, newest first.
 * POST /api/quotes — { contactId, conversationId?, lines, notes?, send? }
 *      agent+. `send: true` also sends it on WhatsApp right away.
 */
export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const contactId = new URL(request.url).searchParams.get('contact_id')
    let q = supabase
      .from('quotes')
      .select('*')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
      .limit(50)
    if (contactId) q = q.eq('contact_id', contactId)
    const { data, error } = await q
    if (error) return NextResponse.json({ quotes: [], available: false })
    return NextResponse.json({ quotes: data ?? [], available: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')
    const limit = checkRateLimit(`quotes:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    const lines = parseQuoteLines(body?.lines)
    const contactId = typeof body?.contactId === 'string' ? body.contactId : null
    if (!contactId || !lines) {
      return NextResponse.json({ error: 'contactId and at least one valid line are required' }, { status: 400 })
    }
    const admin = supabaseAdmin()
    const quote = await createQuote(supabase, admin, {
      accountId,
      userId,
      contactId,
      conversationId: typeof body?.conversationId === 'string' ? body.conversationId : null,
      lines,
      notes: typeof body?.notes === 'string' ? body.notes.slice(0, 2000) : null,
    })
    if (body?.send === true) {
      await sendQuote(supabase, admin, { accountId, userId, quoteId: quote.id })
    }
    return NextResponse.json({ quote })
  } catch (err) {
    return quoteErrorResponse(err)
  }
}
