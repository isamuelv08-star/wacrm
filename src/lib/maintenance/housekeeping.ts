import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Prune log-style tables that otherwise grow forever and eat the
 * database quota (500 MB on Supabase's free plan). Only rows nobody
 * looks at any more: read notifications, old automation run logs,
 * the AI's per-turn audit trail, dead webhook events. Messages,
 * contacts, deals and their history are never touched here.
 *
 * Runs from the archive-media cron, at most once an hour.
 */

const RULES: { table: string; column: string; days: number; extra?: [string, string] }[] = [
  // Read notifications after 60 days; unread ones after 180.
  { table: 'notifications', column: 'created_at', days: 60, extra: ['read_at', 'not.null'] },
  { table: 'notifications', column: 'created_at', days: 180 },
  // "Why did the AI (not) move this deal" — useful for weeks, not forever.
  { table: 'deal_ai_assessments', column: 'created_at', days: 90 },
  // Automation run history shown on each automation's log page.
  { table: 'automation_logs', column: 'created_at', days: 90 },
  // Webhook events that failed every retry — kept a month for debugging.
  { table: 'webhook_inbox', column: 'received_at', days: 30, extra: ['status', 'failed'] },
]

export async function runHousekeeping(db: SupabaseClient): Promise<Record<string, number>> {
  const deleted: Record<string, number> = {}
  for (const rule of RULES) {
    const cutoff = new Date(Date.now() - rule.days * 86_400_000).toISOString()
    let q = db.from(rule.table).delete({ count: 'exact' }).lt(rule.column, cutoff)
    if (rule.extra) {
      const [col, cond] = rule.extra
      q = cond === 'not.null' ? q.not(col, 'is', null) : q.eq(col, cond)
    }
    const { count, error } = await q
    if (error) {
      // A table that doesn't exist on this database yet — skip it.
      console.warn(`[housekeeping] ${rule.table}: ${error.message}`)
      continue
    }
    deleted[rule.table] = (deleted[rule.table] ?? 0) + (count ?? 0)
  }
  return deleted
}

/** True during the first cron tick of each hour (the cron runs every 5 min). */
export function isHousekeepingTick(now = new Date()): boolean {
  return now.getUTCMinutes() < 5
}
