import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveOwnersAndAdmins } from './recipients'
import { computeStalenessTier } from '@/lib/pipelines/lead-staleness'
import { serverNotificationText } from '@/lib/i18n/server-text'

// ============================================================
// Escalating "lead going cold" alerting — the pipeline-board analog of
// hot-lead-alerts.ts. Where that one fires a single notification once
// a HOT-scored contact goes unanswered past the account's own
// threshold, this one scans every OPEN deal (any lead_score, or none)
// and re-notifies as the SAME silence crosses each of 4 fixed tiers
// (see lib/pipelines/lead-staleness.ts) — the exact tiers the deal
// card's own badge shows, so "what the badge says" and "what got
// notified" can never disagree.
//
// Joined by contact_id (a second query, not an embedded `deals ->
// conversations` select) rather than `deals.conversation_id` — that
// column exists but isn't reliably populated on every deal-creation
// path (e.g. lead-scoring.ts's auto-created deals never set it), so
// an inner-join embed on it would silently skip most deals. contact_id
// is always set, and a contact has at most one conversation
// (migration 036's dedup), so this join is exact.
//
// Reads `conversations.last_message_sender_type` directly (migration
// 050's trigger keeps it in sync on every message insert) rather than
// a per-conversation `messages` query — cheaper than hot-lead-alerts'
// N+1 pattern, and this scan's candidate set (every open deal) is
// typically larger.
//
// Invoked on a schedule via GET /api/cron/lead-staleness-alerts (same
// shared-secret pattern as the other cron routes). Best-effort per
// deal — one failure must never stop the rest of the scan.
// ============================================================

const PAGE_SIZE = 500
const CONTACT_CHUNK = 100
/** The first staleness tier's threshold — nothing younger can alert. */
const MIN_STALE_MINUTES = 5

export interface LeadStalenessScanResult {
  scanned: number
  alerted: number
}

interface ConversationRow {
  id: string
  account_id: string
  contact_id: string
  assigned_agent_id: string | null
  last_message_at: string | null
  last_message_sender_type: string | null
  stale_alert_tier: number
  stale_alert_message_at: string | null
  contacts: { name: string | null; phone: string } | null
}

export async function runLeadStalenessAlertScan(
  db: SupabaseClient,
): Promise<LeadStalenessScanResult> {
  const now = Date.now()
  const cutoff = new Date(now - MIN_STALE_MINUTES * 60_000).toISOString()

  // Conversations waiting on us, oldest silence first, paged. Starting
  // from conversations (not deals) means one alert per thread even when
  // a contact has two open deals, and the "waiting on us" filter runs
  // in SQL — the old scan took 200 open deals across ALL accounts with
  // no ORDER BY, so beyond 200 the same rows came back every run and
  // everyone else never got an alert.
  const waiting: ConversationRow[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data: page, error } = await db
      .from('conversations')
      .select(
        'id, account_id, contact_id, assigned_agent_id, last_message_at, last_message_sender_type, stale_alert_tier, stale_alert_message_at, contacts(name, phone)',
      )
      .eq('last_message_sender_type', 'customer')
      .lte('last_message_at', cutoff)
      .not('contact_id', 'is', null)
      .order('last_message_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
    if (error) {
      console.error('[lead-staleness-alerts] conversation scan failed:', error.message)
      break
    }
    if (!page || page.length === 0) break
    waiting.push(...(page as unknown as ConversationRow[]))
    if (page.length < PAGE_SIZE) break
  }
  if (waiting.length === 0) return { scanned: 0, alerted: 0 }

  // Only leads that are still in play (an open deal).
  const withOpenDeal = new Set<string>()
  const contactIds = [...new Set(waiting.map((c) => c.contact_id))]
  for (let i = 0; i < contactIds.length; i += CONTACT_CHUNK) {
    const { data: deals, error } = await db
      .from('deals')
      .select('contact_id')
      .eq('status', 'open')
      .in('contact_id', contactIds.slice(i, i + CONTACT_CHUNK))
    if (error) {
      console.error('[lead-staleness-alerts] deal lookup failed:', error.message)
      continue
    }
    for (const d of (deals ?? []) as { contact_id: string }[]) withOpenDeal.add(d.contact_id)
  }

  const t = serverNotificationText()
  let alerted = 0

  for (const conv of waiting) {
    try {
      if (!withOpenDeal.has(conv.contact_id) || !conv.last_message_at) continue

      const minutesUnanswered = (now - new Date(conv.last_message_at).getTime()) / 60000
      const tier = computeStalenessTier(minutesUnanswered)
      if (tier === 0) continue

      // Already notified this exact message at this tier (or higher) —
      // a different/newer last_message_at means the silence reset
      // (someone replied, then the customer wrote again), so a stale
      // tracked tier no longer applies and this re-evaluates as new.
      const sameMessage =
        conv.stale_alert_message_at &&
        new Date(conv.stale_alert_message_at).getTime() ===
          new Date(conv.last_message_at).getTime()
      if (sameMessage && conv.stale_alert_tier >= tier) continue

      const recipients = await resolveRecipients(db, conv.account_id, conv.assigned_agent_id)
      if (recipients.length === 0) continue

      const contactName = conv.contacts?.name || conv.contacts?.phone || t('aLead')
      const elapsed =
        minutesUnanswered >= 60
          ? `${Math.floor(minutesUnanswered / 60)}h`
          : `${Math.floor(minutesUnanswered / 5) * 5} min`

      const { error: insertErr } = await db.from('notifications').insert(
        recipients.map((userId) => ({
          account_id: conv.account_id,
          user_id: userId,
          type: 'lead_stale' as const,
          conversation_id: conv.id,
          contact_id: conv.contact_id,
          title: tier >= 4 ? t('leadAtRiskTitle') : t('leadCoolingTitle'),
          body: t('leadStaleBody', { name: contactName, elapsed }),
        })),
      )
      if (insertErr) {
        console.error('[lead-staleness-alerts] notification insert failed:', insertErr.message)
        continue
      }

      const { error: markErr } = await db
        .from('conversations')
        .update({ stale_alert_tier: tier, stale_alert_message_at: conv.last_message_at })
        .eq('id', conv.id)
      if (markErr) {
        console.error('[lead-staleness-alerts] failed to mark conversation alerted:', markErr.message)
      }

      alerted++
    } catch (err) {
      console.error('[lead-staleness-alerts] scan failed for conversation', conv.id, err)
    }
  }

  return { scanned: waiting.length, alerted }
}

/** Same fallback rule as hot-lead-alerts.ts: the assigned agent if
 *  there is one, otherwise every owner/admin. */
async function resolveRecipients(
  db: SupabaseClient,
  accountId: string,
  assignedAgentId: string | null,
): Promise<string[]> {
  if (assignedAgentId) return [assignedAgentId]
  return resolveOwnersAndAdmins(db, accountId)
}
