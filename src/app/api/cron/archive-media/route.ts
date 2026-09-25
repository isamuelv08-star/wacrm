import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/notifications/admin-client'
import { runMediaArchiveBackfill } from '@/lib/media/archive'

/**
 * Copy recent customer media into the private inbound-media bucket
 * (migration 111) when the webhook's inline copy missed it — before
 * the provider's own copy expires. Same shared-secret auth as the
 * other cron routes (x-cron-secret / AUTOMATION_CRON_SECRET).
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

  const result = await runMediaArchiveBackfill(supabaseAdmin())
  return NextResponse.json(result)
}
