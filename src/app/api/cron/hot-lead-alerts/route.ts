import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/notifications/admin-client'
import { runHotLeadAlertScan } from '@/lib/notifications/hot-lead-alerts'

/**
 * Scan every account's open conversations for a HOT lead gone
 * unanswered by a human past its configured threshold
 * (accounts.hot_lead_alert_minutes) and raise a notification.
 *
 * Meant to be hit on a schedule (external pinger / Vercel Cron) —
 * requires a shared secret via `x-cron-secret`, same auth pattern as
 * /api/automations/cron (reuses AUTOMATION_CRON_SECRET rather than
 * introducing a second env var for what is, from an ops standpoint,
 * the same kind of trusted-scheduler check).
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

  const result = await runHotLeadAlertScan(supabaseAdmin())
  return NextResponse.json(result)
}
