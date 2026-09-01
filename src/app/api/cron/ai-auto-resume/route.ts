import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { runAiAutoResumeScan } from '@/lib/ai/auto-resume'

/**
 * Bring the AI auto-reply bot back on any conversation it handed off
 * (migration 068) that no human has picked up within the account's
 * configured `auto_resume_after_minutes` — opt-in, off by default. See
 * `runAiAutoResumeScan`'s doc comment for exactly what it will and
 * won't touch.
 *
 * Same trusted-scheduler auth pattern as every other /api/cron/* route
 * (shared `AUTOMATION_CRON_SECRET` via `x-cron-secret`) — point an
 * external scheduler here every 5 minutes, same interval as
 * hot-lead-alerts and lead-staleness-alerts.
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

  const result = await runAiAutoResumeScan(supabaseAdmin())
  return NextResponse.json(result)
}
