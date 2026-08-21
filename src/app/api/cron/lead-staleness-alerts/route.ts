import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/notifications/admin-client'
import { runLeadStalenessAlertScan } from '@/lib/notifications/lead-staleness-alerts'

/**
 * Scan every account's open pipeline deals for a lead gone unanswered
 * past one of 4 fixed escalation tiers (5/15/30/60 min — see
 * lib/pipelines/lead-staleness.ts) and raise a notification per tier
 * crossed.
 *
 * Meant to be hit on a schedule (external pinger / Vercel Cron) —
 * requires a shared secret via `x-cron-secret`, same auth pattern as
 * /api/cron/hot-lead-alerts and /api/automations/cron (reuses
 * AUTOMATION_CRON_SECRET rather than introducing a second env var for
 * what is, from an ops standpoint, the same kind of trusted-scheduler
 * check). A 5-minute poll interval is the finest useful granularity
 * given the tightest tier boundary is 5 minutes.
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

  const result = await runLeadStalenessAlertScan(supabaseAdmin())
  return NextResponse.json(result)
}
