import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/notifications/admin-client'
import { runMediaArchiveBackfill } from '@/lib/media/archive'
import { runMediaRetention } from '@/lib/media/retention'
import { isHousekeepingTick, runHousekeeping } from '@/lib/maintenance/housekeeping'

/**
 * Also applies media retention (src/lib/media/retention.ts).
 *
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

  const db = supabaseAdmin()
  const archive = await runMediaArchiveBackfill(db)
  // Same job frees the space: files past each account's retention
  // period (migration 119, off unless an admin sets one).
  const retention = await runMediaRetention(db)
  // Once an hour: prune log tables that would otherwise grow forever.
  const housekeeping = isHousekeepingTick() ? await runHousekeeping(db) : null
  return NextResponse.json({ ...archive, retention, housekeeping })
}
