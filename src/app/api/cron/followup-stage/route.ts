import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/notifications/admin-client'
import { runFollowupStageScan } from '@/lib/pipelines/followup-scan'

/**
 * Scan every account's Seguimiento stage(s) for open deals that have
 * gone quiet past that account's configured threshold
 * (accounts.followup_after_hours) and move them in — the automatic
 * counterpart to `ensureDealInQualifiedStage()`, just time-triggered
 * instead of score-triggered.
 *
 * Meant to be hit on a schedule (external pinger — this is a self-
 * hosted deployment with no in-container scheduler) — requires a
 * shared secret via `x-cron-secret`, same auth pattern as
 * /api/cron/hot-lead-alerts (reuses AUTOMATION_CRON_SECRET).
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

  const result = await runFollowupStageScan(supabaseAdmin())
  return NextResponse.json(result)
}
