import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { supabaseAdmin } from '@/lib/notifications/admin-client'
import { sendQuote } from '@/lib/quotes/service'
import { quoteErrorResponse } from '@/lib/quotes/http'

type Params = { params: Promise<{ id: string }> }

/** POST /api/quotes/[id]/send (agent+) — the PDF to the customer on WhatsApp. */
export async function POST(_request: Request, { params }: Params) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')
    const limit = checkRateLimit(`quotes-send:${userId}`, RATE_LIMITS.send)
    if (!limit.success) return rateLimitResponse(limit)
    const { id } = await params
    const result = await sendQuote(supabase, supabaseAdmin(), { accountId, userId, quoteId: id })
    return NextResponse.json({ success: true, ...result })
  } catch (err) {
    return quoteErrorResponse(err)
  }
}
