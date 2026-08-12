import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Pick the next agent for round-robin assignment and advance the
 * account's rotation cursor, via the atomic `next_round_robin_agent`
 * RPC (migration 042). Shared by three call sites — a brand-new
 * inbound conversation (webhook-processor.ts), an AI auto-reply
 * handoff with no fixed `handoff_agent_id` configured (auto-reply.ts),
 * and the automations engine's `assign_conversation` round-robin mode
 * — so all three rotate over the same cursor and pool.
 *
 * Returns null when the RPC errors or the account has no eligible
 * agents (e.g. a solo owner who hasn't opted in) — callers treat that
 * as "no agent resolved" and leave the conversation unassigned, same
 * as before this feature existed.
 */
export async function pickRoundRobinAgent(
  db: SupabaseClient,
  accountId: string,
): Promise<string | null> {
  const { data, error } = await db.rpc('next_round_robin_agent', {
    p_account_id: accountId,
  })
  if (error) {
    console.error('[round-robin] next_round_robin_agent failed:', error.message)
    return null
  }
  return data ?? null
}
