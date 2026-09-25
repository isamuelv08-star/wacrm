import type { SupabaseClient } from '@supabase/supabase-js'
import { loadAiConfig } from '../ai/config'
import { buildPromiseExtractionPrompt } from '../ai/defaults'
import { generatePromiseExtraction } from '../ai/generate'
import { logAiUsage } from '../ai/usage'
import { looksLikePromise } from './promise-detect'

// ============================================================
// Promise Tracker scan — fase 4 of the Auditoría Saleslid roadmap.
//
// Invoked on a schedule via GET /api/cron/promise-tracker, same
// shared-secret pattern as every other cron in this app. Two
// independent jobs per tick, same bundling choice fase 1's
// sales-intelligence cron made:
//   1. Sweep PENDING promises whose due_at has passed → OVERDUE.
//      Purely deterministic, no AI, cheap.
//   2. For each active account, scan agent-sent text messages newer
//      than that account's scan cursor, keep only the ones that pass
//      the cheap keyword pre-filter (promise-detect.ts), and send just
//      those to a dedicated AI extraction call
//      (generatePromiseExtraction) to confirm/dismiss and estimate a
//      due date. Never one call per message — only per candidate.
//
// Cursor tradeoff, stated plainly: the cursor advances past an entire
// scanned batch once it's been considered, even if one candidate's AI
// call fails mid-batch — the same "best effort, never let one failure
// block the rest" posture the rest of this codebase's scans take
// (hot-lead-alerts, lead-staleness-alerts). A transient failure here
// means one possible promise silently goes undetected rather than the
// scan retrying it forever; that's the accepted tradeoff.
// ============================================================

const MAX_CANDIDATES_PER_ACCOUNT_SCAN = 20
const MAX_MESSAGES_PER_ACCOUNT_SCAN = 500
const CONTEXT_MESSAGES_BEFORE = 4
const DEFAULT_DUE_MINUTES_WHEN_UNSPECIFIED = 24 * 60

export interface PromiseTrackerScanResult {
  accountsScanned: number
  candidatesChecked: number
  promisesDetected: number
  promisesMarkedOverdue: number
}

export async function runPromiseTrackerScan(db: SupabaseClient): Promise<PromiseTrackerScanResult> {
  const promisesMarkedOverdue = await markOverduePromises(db)

  const { data: accounts, error } = await db.from('accounts').select('id').eq('status', 'active')
  if (error) {
    console.error('[promise-tracker] account scan failed:', error.message)
    return { accountsScanned: 0, candidatesChecked: 0, promisesDetected: 0, promisesMarkedOverdue }
  }

  let candidatesChecked = 0
  let promisesDetected = 0

  for (const account of (accounts ?? []) as { id: string }[]) {
    try {
      const result = await scanAccountForPromises(db, account.id)
      candidatesChecked += result.candidatesChecked
      promisesDetected += result.promisesDetected
    } catch (err) {
      console.error('[promise-tracker] scan failed for account', account.id, err)
    }
  }

  return {
    accountsScanned: (accounts ?? []).length,
    candidatesChecked,
    promisesDetected,
    promisesMarkedOverdue,
  }
}

async function markOverduePromises(db: SupabaseClient): Promise<number> {
  const { data, error } = await db
    .from('promises')
    .update({ status: 'overdue' })
    .eq('status', 'pending')
    .lt('due_at', new Date().toISOString())
    .select('id')
  if (error) {
    console.error('[promise-tracker] overdue sweep failed:', error.message)
    return 0
  }
  return (data ?? []).length
}

interface ConversationRef {
  account_id: string
  contact_id: string | null
  assigned_agent_id: string | null
}

interface CandidateMessageRow {
  id: string
  conversation_id: string
  content_text: string | null
  created_at: string
  conversation: ConversationRef[] | ConversationRef | null
}

async function scanAccountForPromises(
  db: SupabaseClient,
  accountId: string,
): Promise<{ candidatesChecked: number; promisesDetected: number }> {
  const config = await loadAiConfig(db, accountId)
  if (!config) return { candidatesChecked: 0, promisesDetected: 0 }

  const { data: cursorRow } = await db
    .from('promise_scan_cursor')
    .select('last_scanned_message_created_at')
    .eq('account_id', accountId)
    .maybeSingle()
  // No prior cursor: start from now rather than trawling this
  // account's entire message history the first time this feature
  // runs for it — a long-lived account shouldn't get a burst of AI
  // calls for months of old conversations.
  const since = (cursorRow as { last_scanned_message_created_at: string } | null)?.last_scanned_message_created_at
    ?? new Date().toISOString()

  const { data: rows, error } = await db
    .from('messages')
    .select(
      'id, conversation_id, content_text, created_at, conversation:conversations!inner(account_id, contact_id, assigned_agent_id)',
    )
    .eq('sender_type', 'agent')
    .eq('content_type', 'text')
    .eq('conversation.account_id', accountId)
    .gt('created_at', since)
    .order('created_at', { ascending: true })
    .limit(MAX_MESSAGES_PER_ACCOUNT_SCAN)
  if (error) {
    console.error('[promise-tracker] message scan failed for account', accountId, error.message)
    return { candidatesChecked: 0, promisesDetected: 0 }
  }

  const messages = (rows ?? []) as unknown as CandidateMessageRow[]
  if (messages.length === 0) return { candidatesChecked: 0, promisesDetected: 0 }

  const allCandidates = messages.filter((m) => looksLikePromise(m.content_text ?? ''))
  const candidates = allCandidates.slice(0, MAX_CANDIDATES_PER_ACCOUNT_SCAN)

  // Advance the cursor only as far as this run actually got. When the
  // candidate cap cut the list short, stop at the last candidate we
  // process — the old code jumped to the last of all 500 fetched
  // messages, so every candidate past the first 20 was lost for good.
  const cursorAt =
    allCandidates.length > candidates.length
      ? candidates[candidates.length - 1].created_at
      : messages[messages.length - 1].created_at
  const { error: cursorErr } = await db
    .from('promise_scan_cursor')
    .upsert({ account_id: accountId, last_scanned_message_created_at: cursorAt })
  if (cursorErr) {
    console.error('[promise-tracker] cursor update failed for account', accountId, cursorErr.message)
  }

  let promisesDetected = 0
  for (const m of candidates) {
    try {
      const conv = Array.isArray(m.conversation) ? m.conversation[0] : m.conversation
      if (!conv) continue

      const contextMessages = await buildContextUpTo(db, m.conversation_id, m.created_at)
      const { isPromise, promiseText, dueInMinutes, usage } = await generatePromiseExtraction({
        config,
        systemPrompt: buildPromiseExtractionPrompt(),
        messages: contextMessages,
      })

      void logAiUsage(db, {
        accountId,
        conversationId: m.conversation_id,
        mode: 'promise_extract',
        provider: config.provider,
        model: config.model,
        usage,
      })

      if (!isPromise || !promiseText) continue

      const dueMinutes = dueInMinutes ?? DEFAULT_DUE_MINUTES_WHEN_UNSPECIFIED
      const dueAt = new Date(new Date(m.created_at).getTime() + dueMinutes * 60_000).toISOString()

      const { error: insErr } = await db.from('promises').insert({
        account_id: accountId,
        conversation_id: m.conversation_id,
        contact_id: conv.contact_id,
        promised_by: conv.assigned_agent_id,
        promise_text: promiseText,
        source_message_id: m.id,
        due_at: dueAt,
        status: 'pending',
        detected_by: 'ai',
      })
      if (insErr) {
        console.error('[promise-tracker] promise insert failed:', insErr.message)
        continue
      }
      promisesDetected++
    } catch (err) {
      console.error('[promise-tracker] extraction failed for message', m.id, err)
    }
  }

  return { candidatesChecked: candidates.length, promisesDetected }
}

/** Last few text messages up to and including the candidate itself —
 *  enough for the model to see what the promise is actually about,
 *  without pulling context from AFTER the message being judged. */
async function buildContextUpTo(
  db: SupabaseClient,
  conversationId: string,
  uptoIso: string,
): Promise<{ role: 'user' | 'assistant'; content: string }[]> {
  const { data, error } = await db
    .from('messages')
    .select('sender_type, content_text')
    .eq('conversation_id', conversationId)
    .eq('content_type', 'text')
    .lte('created_at', uptoIso)
    .order('created_at', { ascending: false })
    .limit(CONTEXT_MESSAGES_BEFORE + 1)
  if (error) throw error

  const rows = ((data ?? []) as { sender_type: string; content_text: string | null }[]).reverse()
  return rows
    .filter((m): m is { sender_type: string; content_text: string } => !!m.content_text && !!m.content_text.trim())
    .map((m) => ({
      role: m.sender_type === 'customer' ? ('user' as const) : ('assistant' as const),
      content: m.content_text.trim(),
    }))
}
