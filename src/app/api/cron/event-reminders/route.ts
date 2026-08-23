import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/notifications/admin-client'
import { runEventReminderScan } from '@/lib/notifications/event-reminders'

/**
 * Scan every account's pending calendar events for one whose reminder
 * window has arrived and raise a notification for whoever owns it.
 *
 * Meant to be hit on a schedule (external pinger), same auth pattern
 * as /api/cron/hot-lead-alerts — requires a shared secret via
 * `x-cron-secret` (reuses AUTOMATION_CRON_SECRET).
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

  const result = await runEventReminderScan(supabaseAdmin())
  return NextResponse.json(result)
}
