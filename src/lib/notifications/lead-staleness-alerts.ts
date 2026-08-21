import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveOwnersAndAdmins } from './recipients'
import { computeStalenessTier, stalenessTierLabelKey } from '@/lib/pipelines/lead-staleness'

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

const MAX_CANDIDATES_PER_SCAN = 200

export interface LeadStalenessScanResult {
  scanned: number
  alerted: number
}

interface CandidateDeal {
  id: string
  account_id: string
  contact_id: string
  contacts: { name: string | null; phone: string } | null
}

interface ConversationRow {
  id: string
  contact_id: string
  assigned_agent_id: string | null
  last_message_at: string | null
  last_message_sender_type: string | null
  stale_alert_tier: number
  stale_alert_message_at: string | null
}

export async function runLeadStalenessAlertScan(
  db: SupabaseClient,
): Promise<LeadStalenessScanResult> {
  const { data: deals, error: dealsErr } = await db
    .from('deals')
    .select('id, account_id, contact_id, contacts(name, phone)')
    .eq('status', 'open')
    .not('contact_id', 'is', null)
    .limit(MAX_CANDIDATES_PER_SCAN)

  if (dealsErr) {
    console.error('[lead-staleness-alerts] deal scan failed:', dealsErr.message)
    return { scanned: 0, alerted: 0 }
  }
  if (!deals || deals.length === 0) return { scanned: 0, alerted: 0 }

  const contactIds = (deals as unknown as CandidateDeal[]).map((d) => d.contact_id)
  const { data: conversations, error: convErr } = await db
    .from('conversations')
    .select(
      'id, contact_id, assigned_agent_id, last_message_at, last_message_sender_type, stale_alert_tier, stale_alert_message_at',
    )
    .in('contact_id', contactIds)

  if (convErr) {
    console.error('[lead-staleness-alerts] conversation lookup failed:', convErr.message)
    return { scanned: deals.length, alerted: 0 }
  }

  const convByContact = new Map<string, ConversationRow>()
  for (const c of (conversations ?? []) as ConversationRow[]) {
    convByContact.set(c.contact_id, c)
  }

  let alerted = 0
  const now = Date.now()

  for (const deal of deals as unknown as CandidateDeal[]) {
    try {
      const conv = convByContact.get(deal.contact_id)
      if (!conv || conv.last_message_sender_type !== 'customer' || !conv.last_message_at) {
        continue // no conversation yet, or nothing unanswered
      }

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

      const recipients = await resolveRecipients(db, deal.account_id, conv.assigned_agent_id)
      if (recipients.length === 0) continue

      const contactName = deal.contacts?.name || deal.contacts?.phone || 'A lead'
      const labelKey = stalenessTierLabelKey(tier)
      const elapsed =
        minutesUnanswered >= 60
          ? `${Math.floor(minutesUnanswered / 60)}h`
          : `${Math.floor(minutesUnanswered / 5) * 5} min`

      const { error: insertErr } = await db.from('notifications').insert(
        recipients.map((userId) => ({
          account_id: deal.account_id,
          user_id: userId,
          type: 'lead_stale' as const,
          conversation_id: conv.id,
          contact_id: deal.contact_id,
          title: tier >= 4 ? 'Lead at risk' : 'Lead going cold',
          body: `${contactName} has gone unanswered for over ${elapsed} (${labelKey ?? 'cooling'}).`,
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
      console.error('[lead-staleness-alerts] scan failed for deal', deal.id, err)
    }
  }

  return { scanned: deals.length, alerted }
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
