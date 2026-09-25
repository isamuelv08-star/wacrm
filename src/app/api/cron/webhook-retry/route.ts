import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/notifications/admin-client'
import { runWebhookRetryScan } from '@/lib/webhooks/inbox'

/**
 * Re-run inbound webhook events a restart interrupted (migration 112's
 * webhook_inbox), and prune old completed ones. Same shared-secret auth
 * as the other cron routes (x-cron-secret / AUTOMATION_CRON_SECRET).
 * Every minute or two is the useful cadence.
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  const supplied = request.headers.get('x-cron-secret') ?? ''
  const suppliedBuf = Buffer.from(supplied)
  const expectedBuf = Buffer.from(expected)
  if (
    suppliedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(suppliedBuf, expectedBuf)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await runWebhookRetryScan(supabaseAdmin())
  return NextResponse.json(result)
}
