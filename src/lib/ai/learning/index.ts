import type { SupabaseClient } from '@supabase/supabase-js'
import { advisorReplyFrom, anonymize, customerTurnBefore, type ThreadRow } from './core'

/**
 * Learning from the advisors (migration 116). See the migration header
 * for the idea; this file is the I/O around the pure helpers in core.ts.
 */

const PAGE = 500
/** Bounds one run: enough for a busy day, cheap for the nightly cron. */
const MAX_MESSAGES_PER_RUN = 3_000

interface CandidateRow {
  id: string
  conversation_id: string
  content_text: string | null
  created_at: string
  conversations: { account_id: string; contact_id: string | null } | { account_id: string; contact_id: string | null }[]
}

export interface MineResult {
  scanned: number
  stored: number
}

/**
 * Turn recent advisor replies into (customer message → advisor reply)
 * examples. Idempotent: an advisor message is stored at most once
 * (source_message_id is unique), so overlapping windows are harmless.
 *
 * `accountId` limits the run to one account (the "learn now" button);
 * the cron runs it for every account with learning on.
 */
export async function mineAdvisorExamples(
  db: SupabaseClient,
  opts: { accountId?: string; sinceHours: number },
): Promise<MineResult> {
  const since = new Date(Date.now() - opts.sinceHours * 3_600_000).toISOString()
  // Leave the last few minutes alone: the advisor may still be typing
  // the rest of the answer.
  const until = new Date(Date.now() - 10 * 60_000).toISOString()

  // Which accounts learn. Pre-116 the column is missing → nobody (the
  // table is missing too).
  let cfgQuery = db.from('ai_configs').select('account_id').eq('learning_enabled', true)
  if (opts.accountId) cfgQuery = cfgQuery.eq('account_id', opts.accountId)
  const { data: cfgRows, error: cfgErr } = await cfgQuery
  if (cfgErr) {
    console.error('[ai learning] reading ai_configs failed:', cfgErr.message)
    return { scanned: 0, stored: 0 }
  }
  const learning = new Set((cfgRows ?? []).map((r) => r.account_id as string))
  if (!learning.size) return { scanned: 0, stored: 0 }

  let scanned = 0
  let stored = 0
  const nameCache = new Map<string, string | null>()
  const outcomeCache = new Map<string, 'open' | 'won' | 'lost'>()

  for (let from = 0; from < MAX_MESSAGES_PER_RUN; from += PAGE) {
    let q = db
      .from('messages')
      .select('id, conversation_id, content_text, created_at, conversations!inner(account_id, contact_id)')
      .eq('sender_type', 'agent')
      .eq('content_type', 'text')
      .or('ai_generated.is.null,ai_generated.eq.false')
      .gte('created_at', since)
      .lte('created_at', until)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (opts.accountId) q = q.eq('conversations.account_id', opts.accountId)
    const { data, error } = await q
    if (error) {
      console.error('[ai learning] scanning advisor messages failed:', error.message)
      break
    }
    const rows = (data ?? []) as CandidateRow[]
    scanned += rows.length

    const toStore: Record<string, unknown>[] = []
    for (const row of rows) {
      const conv = Array.isArray(row.conversations) ? row.conversations[0] : row.conversations
      if (!conv || !learning.has(conv.account_id) || !row.content_text?.trim()) continue

      const [beforeRes, afterRes] = await Promise.all([
        db
          .from('messages')
          .select('sender_type, content_type, content_text, created_at, ai_generated')
          .eq('conversation_id', row.conversation_id)
          .lt('created_at', row.created_at)
          .order('created_at', { ascending: false })
          .limit(8),
        db
          .from('messages')
          .select('sender_type, content_type, content_text, created_at, ai_generated')
          .eq('conversation_id', row.conversation_id)
          .gt('created_at', row.created_at)
          .order('created_at', { ascending: true })
          .limit(4),
      ])
      const customerText = customerTurnBefore((beforeRes.data ?? []) as ThreadRow[], row.created_at)
      if (!customerText) continue
      const reply = advisorReplyFrom(row.content_text, (afterRes.data ?? []) as ThreadRow[], row.created_at)
      if (!reply) continue

      const contactId = conv.contact_id
      let name: string | null = null
      let outcome: 'open' | 'won' | 'lost' = 'open'
      if (contactId) {
        if (!nameCache.has(contactId)) {
          const [{ data: contact }, { data: deals }] = await Promise.all([
            db.from('contacts').select('name').eq('id', contactId).maybeSingle(),
            db.from('deals').select('status').eq('contact_id', contactId),
          ])
          nameCache.set(contactId, (contact?.name as string | null) ?? null)
          const statuses = (deals ?? []).map((d) => d.status as string)
          outcomeCache.set(
            contactId,
            statuses.includes('won') ? 'won' : statuses.length && statuses.every((s) => s === 'lost') ? 'lost' : 'open',
          )
        }
        name = nameCache.get(contactId) ?? null
        outcome = outcomeCache.get(contactId) ?? 'open'
      }

      toStore.push({
        account_id: conv.account_id,
        conversation_id: row.conversation_id,
        source_message_id: row.id,
        customer_text: anonymize(customerText, name),
        advisor_reply: anonymize(reply, name),
        outcome,
        // What sold is imitated right away; the rest waits for an admin.
        status: outcome === 'won' ? 'approved' : 'pending',
      })
    }

    if (toStore.length) {
      const { error: insErr, count } = await db
        .from('ai_learned_examples')
        .upsert(toStore, { onConflict: 'source_message_id', ignoreDuplicates: true, count: 'exact' })
      if (insErr) console.error('[ai learning] storing examples failed:', insErr.message)
      else stored += count ?? 0
    }
    if (rows.length < PAGE) break
  }

  return { scanned, stored }
}

export interface LearnedExample {
  customer: string
  reply: string
}

/**
 * The approved advisor examples most similar to the customer's current
 * message, for the reply / draft prompt. Best-effort: [] on any error
 * (including a database without migration 116).
 */
export async function retrieveLearnedExamples(
  db: SupabaseClient,
  accountId: string,
  queryText: string,
  k = 3,
): Promise<LearnedExample[]> {
  const query = queryText.trim()
  if (!query) return []
  try {
    const { data, error } = await db.rpc('match_ai_learned_examples', {
      p_account_id: accountId,
      p_query: query.slice(0, 1_000),
      p_match_count: k,
    })
    if (error || !Array.isArray(data)) return []
    return (data as { customer_text: string; advisor_reply: string }[]).map((r) => ({
      customer: r.customer_text,
      reply: r.advisor_reply,
    }))
  } catch {
    return []
  }
}
