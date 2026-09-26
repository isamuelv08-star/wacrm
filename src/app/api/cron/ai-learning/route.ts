import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/notifications/admin-client'
import { mineAdvisorExamples } from '@/lib/ai/learning'

/**
 * Nightly: turn the last day's advisor replies into examples the AI
 * learns from (migration 116, src/lib/ai/learning). The window overlaps
 * the previous run on purpose — examples are deduped per message. Same
 * shared-secret auth as the other cron routes (x-cron-secret /
 * AUTOMATION_CRON_SECRET).
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

  const result = await mineAdvisorExamples(supabaseAdmin(), { sinceHours: 30 })
  return NextResponse.json(result)
}
