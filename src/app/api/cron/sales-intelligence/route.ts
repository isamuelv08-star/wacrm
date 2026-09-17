import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/notifications/admin-client'
import { runRiskEngineScan } from '@/lib/sales-intelligence/risk-engine'

/**
 * Recompute the sales-intelligence Risk Engine's six deterministic
 * signals (fase 1 of the Auditoría Saleslid roadmap) for every active
 * account and reconcile `sales_signals`.
 *
 * Same shared-secret pattern as every other cron route in this app
 * (AUTOMATION_CRON_SECRET via `x-cron-secret`) — meant to be hit on the
 * same ~5-minute schedule as hot-lead-alerts / lead-staleness-alerts by
 * whatever external pinger this self-hosted deployment already uses.
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

  const result = await runRiskEngineScan(supabaseAdmin())
  return NextResponse.json(result)
}
