import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { resumePendingExecution, executeAutomation } from '@/lib/automations/engine'
import type { AutomationContext } from '@/lib/automations/engine'
import { isTimeBasedAutomationDue } from '@/lib/automations/schedule'
import type { Automation, TimeBasedTriggerConfig } from '@/types'

/**
 * Drain due `automation_pending_executions` rows. Meant to be hit
 * on a schedule (Vercel Cron / external pinger) — requires a shared
 * secret via the `x-cron-secret` header to match
 * `AUTOMATION_CRON_SECRET`.
 *
 * The claim step (status = 'running') serves as a simple lock so
 * overlapping invocations don't double-process rows. Best-effort
 * only; expensive SELECT ... FOR UPDATE is avoided in favor of a
 * two-step UPDATE-by-id.
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

  const admin = supabaseAdmin()
  const { data: due, error } = await admin
    .from('automation_pending_executions')
    .select('*')
    .eq('status', 'pending')
    .lte('run_at', new Date().toISOString())
    .order('run_at', { ascending: true })
    .limit(50)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!due || due.length === 0) return NextResponse.json({ processed: 0 })

  let processed = 0
  for (const row of due) {
    const { data: claim } = await admin
      .from('automation_pending_executions')
      .update({ status: 'running' })
      .eq('id', row.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle()
    if (!claim) continue

    await resumePendingExecution({
      id: row.id as string,
      automation_id: row.automation_id as string,
      // account_id is NOT NULL on automation_pending_executions
      // post-017; the engine uses it for tenant-scoped lookups.
      account_id: row.account_id as string,
      user_id: row.user_id as string,
      contact_id: (row.contact_id as string | null) ?? null,
      log_id: (row.log_id as string | null) ?? null,
      parent_step_id: (row.parent_step_id as string | null) ?? null,
      branch: (row.branch as 'yes' | 'no' | null) ?? null,
      next_step_position: row.next_step_position as number,
      context: (row.context as AutomationContext) ?? {},
    })
    processed++
  }

  const scheduledFired = await fireDueTimeBasedAutomations(admin)

  return NextResponse.json({ processed, scheduledFired })
}

/**
 * Fires every active `time_based` automation whose schedule is due.
 *
 * Reuses `automations.last_executed_at` as the idempotency marker
 * (already bumped by `increment_automation_execution_count` at the end
 * of every run, time_based or not — no schema change needed) instead
 * of a separate scheduling table. The claim step below still bumps it
 * up front, before `executeAutomation` runs: a slow automation could
 * otherwise still be mid-run on the NEXT cron tick, whose `SELECT` read
 * the same stale `last_executed_at` and would double-fire without this.
 */
async function fireDueTimeBasedAutomations(
  admin: ReturnType<typeof supabaseAdmin>,
): Promise<number> {
  const { data: candidates, error } = await admin
    .from('automations')
    .select('*')
    .eq('trigger_type', 'time_based')
    .eq('is_active', true)

  if (error) {
    console.error('[automations cron] time_based fetch failed:', error)
    return 0
  }
  if (!candidates || candidates.length === 0) return 0

  const now = new Date()
  const nowIso = now.toISOString()
  let fired = 0

  for (const automation of candidates as Automation[]) {
    const cfg = automation.trigger_config as TimeBasedTriggerConfig
    if (!cfg?.schedule) continue
    if (!isTimeBasedAutomationDue(cfg.schedule, cfg.timezone, automation.last_executed_at, now)) {
      continue
    }

    let claim = admin
      .from('automations')
      .update({ last_executed_at: nowIso })
      .eq('id', automation.id)
    claim = automation.last_executed_at
      ? claim.eq('last_executed_at', automation.last_executed_at)
      : claim.is('last_executed_at', null)
    const { data: claimed } = await claim.select('id').maybeSingle()
    if (!claimed) continue // another invocation (or a run still in flight) beat us to it

    await executeAutomation(automation, {
      accountId: automation.account_id,
      triggerType: 'time_based',
      contactId: null,
      context: {},
    })
    fired++
  }

  return fired
}
