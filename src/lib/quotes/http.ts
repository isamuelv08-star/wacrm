import { NextResponse } from 'next/server'
import { toErrorResponse } from '@/lib/auth/account'
import { SendMessageError } from '@/lib/whatsapp/send-message'
import { QuoteError } from './service'

/** Error → response for the quote routes (typed codes the UI can translate). */
export function quoteErrorResponse(err: unknown) {
  if (err instanceof QuoteError) return NextResponse.json({ error: err.code }, { status: err.status })
  if (err instanceof SendMessageError) {
    return NextResponse.json(
      { error: err.message, code: 'send_failed' },
      { status: err.status >= 500 ? 502 : err.status },
    )
  }
  return toErrorResponse(err)
}
