import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/notifications/admin-client'
import { runPromiseTrackerScan } from '@/lib/sales-intelligence/promise-tracker'

/**
 * Promise Tracker (fase 4 of the Auditoría Saleslid roadmap): sweeps
 * PENDING promises past their due date to OVERDUE, then scans each
 * active account's new agent messages for verbal commitments (via a
 * cheap keyword filter, escalating only real candidates to a dedicated
 * AI call) and records them.
 *
 * Same shared-secret pattern as every other cron route in this app —
 * meant to run on the same ~5-minute schedule as the rest.
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

  const result = await runPromiseTrackerScan(supabaseAdmin())
  return NextResponse.json(result)
}
