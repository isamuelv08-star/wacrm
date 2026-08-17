import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveOwnersAndAdmins } from './recipients'

// ============================================================
// HOT lead response-time alerting.
//
// Complements the AI lead-scoring flow (migration 038): once a
// contact is scored `lead_score = 'hot'`, the team should get pulled
// in if nobody human replies within the account's configured window.
// An AI auto-reply keeping the conversation going does NOT count as
// "handled" here — the whole point is getting a human on a hot lead,
// not letting the bot carry it indefinitely.
//
// Invoked on a schedule via GET /api/cron/hot-lead-alerts (same
// shared-secret pattern as /api/automations/cron). Best-effort per
// conversation — one failure must never stop the rest of the scan.
// ============================================================

const MAX_CANDIDATES_PER_SCAN = 200

export interface HotLeadAlertScanResult {
  scanned: number
  alerted: number
}

interface CandidateConversation {
  id: string
  account_id: string
  assigned_agent_id: string | null
  hot_lead_last_alerted_message_at: string | null
  contact_id: string
  // Embedded relations — Supabase's generated types for `!inner`
  // joins are awkward to hand-declare precisely here, so this stays
  // loosely typed at the DB boundary like the rest of this codebase's
  // service-role query code (see webhook-processor.ts's ContactRow).
  contacts: { lead_score: string | null; name: string | null; phone: string }
  accounts: { hot_lead_alert_minutes: number }
}

/**
 * Scan every account's open conversations for a HOT lead whose last
 * message is from the customer and has gone unanswered by a human
 * past that account's configured threshold, and raise one
 * notification per silence period (never re-alerts the same
 * unanswered message twice — see hot_lead_last_alerted_message_at).
 */
export async function runHotLeadAlertScan(
  db: SupabaseClient,
): Promise<HotLeadAlertScanResult> {
  const { data: candidates, error } = await db
    .from('conversations')
    .select(
      'id, account_id, assigned_agent_id, hot_lead_last_alerted_message_at, contact_id, contacts!inner(lead_score, name, phone), accounts!inner(hot_lead_alert_minutes)',
    )
    .eq('status', 'open')
    .eq('contacts.lead_score', 'hot')
    .limit(MAX_CANDIDATES_PER_SCAN)

  if (error) {
    console.error('[hot-lead-alerts] candidate scan failed:', error.message)
    return { scanned: 0, alerted: 0 }
  }
  if (!candidates || candidates.length === 0) {
    return { scanned: 0, alerted: 0 }
  }

  let alerted = 0
  const now = Date.now()

  for (const conv of candidates as unknown as CandidateConversation[]) {
    try {
      const thresholdMinutes = conv.accounts.hot_lead_alert_minutes
      if (!thresholdMinutes || thresholdMinutes <= 0) continue // disabled for this account

      const { data: lastMessage, error: msgErr } = await db
        .from('messages')
        .select('sender_type, created_at')
        .eq('conversation_id', conv.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (msgErr) {
        console.error('[hot-lead-alerts] last-message lookup failed:', msgErr.message)
        continue
      }
      // No message yet, or the last word was already ours (human or
      // bot) — nothing unanswered to alert on.
      if (!lastMessage || lastMessage.sender_type !== 'customer') continue

      const messageAgeMinutes = (now - new Date(lastMessage.created_at).getTime()) / 60000
      if (messageAgeMinutes < thresholdMinutes) continue

      // Already alerted for this exact message (or a later one) —
      // don't re-notify on every cron tick for the same silence.
      if (
        conv.hot_lead_last_alerted_message_at &&
        new Date(conv.hot_lead_last_alerted_message_at) >= new Date(lastMessage.created_at)
      ) {
        continue
      }

      const recipients = await resolveRecipients(db, conv.account_id, conv.assigned_agent_id)
      if (recipients.length === 0) continue

      const contactName = conv.contacts.name || conv.contacts.phone
      const { error: insertErr } = await db.from('notifications').insert(
        recipients.map((userId) => ({
          account_id: conv.account_id,
          user_id: userId,
          type: 'hot_lead_unanswered' as const,
          conversation_id: conv.id,
          contact_id: conv.contact_id,
          title: 'HOT lead waiting for a reply',
          body: `${contactName} hasn't heard back in over ${thresholdMinutes} minutes.`,
        })),
      )
      if (insertErr) {
        console.error('[hot-lead-alerts] notification insert failed:', insertErr.message)
        continue
      }

      const { error: markErr } = await db
        .from('conversations')
        .update({ hot_lead_last_alerted_message_at: lastMessage.created_at })
        .eq('id', conv.id)
      if (markErr) {
        console.error('[hot-lead-alerts] failed to mark conversation alerted:', markErr.message)
      }

      alerted++
    } catch (err) {
      console.error('[hot-lead-alerts] scan failed for conversation', conv.id, err)
    }
  }

  return { scanned: candidates.length, alerted }
}

/**
 * The assigned agent if the conversation has one; otherwise every
 * owner/admin of the account, so an unassigned HOT lead still reaches
 * someone who can pick it up.
 */
async function resolveRecipients(
  db: SupabaseClient,
  accountId: string,
  assignedAgentId: string | null,
): Promise<string[]> {
  if (assignedAgentId) return [assignedAgentId]
  return resolveOwnersAndAdmins(db, accountId)
}
