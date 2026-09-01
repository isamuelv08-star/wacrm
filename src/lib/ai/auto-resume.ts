import type { SupabaseClient } from '@supabase/supabase-js'

export interface AiAutoResumeResult {
  scanned: number
  resumed: number
}

/**
 * Auto-resumes AI handoffs nobody picked up (migration 068, opt-in via
 * `ai_configs.auto_resume_after_minutes`).
 *
 * Only ever acts on a conversation whose `ai_paused_at` is set — that
 * column is written exclusively by the bot's own handoff path
 * (`dispatchInboundToAiReply` in `auto-reply.ts`); every explicit human
 * action through the inbox toggle (`/api/ai/autoreply/[conversationId]`,
 * both "Take over" and "Resume AI") clears it. So this can never
 * override a human who actually engaged — it only ever un-strands a
 * customer nobody has responded to.
 *
 * Belt-and-suspenders: even a conversation with `ai_paused_at` set is
 * skipped if an agent-authored message landed after that timestamp — a
 * human quietly replying without clicking "Take over" still counts as
 * "handled," so the bot doesn't barge back into a thread mid-reply.
 *
 * Meant to be called from a scheduled route (see
 * /api/cron/ai-auto-resume) every few minutes — cheap no-op when no
 * account has opted in.
 */
export async function runAiAutoResumeScan(
  db: SupabaseClient,
): Promise<AiAutoResumeResult> {
  const { data: configs, error: configErr } = await db
    .from('ai_configs')
    .select('account_id, auto_resume_after_minutes')
    .not('auto_resume_after_minutes', 'is', null)
    .eq('is_active', true)
    .eq('auto_reply_enabled', true)

  if (configErr) {
    console.error('[ai auto-resume] config load failed:', configErr.message)
    return { scanned: 0, resumed: 0 }
  }
  if (!configs || configs.length === 0) return { scanned: 0, resumed: 0 }

  let scanned = 0
  let resumed = 0

  for (const cfg of configs) {
    const minutes = cfg.auto_resume_after_minutes as number
    const cutoff = new Date(Date.now() - minutes * 60_000).toISOString()

    const { data: candidates, error: candErr } = await db
      .from('conversations')
      .select('id, ai_paused_at')
      .eq('account_id', cfg.account_id)
      .eq('ai_autoreply_disabled', true)
      .not('ai_paused_at', 'is', null)
      .lte('ai_paused_at', cutoff)

    if (candErr) {
      console.error(
        `[ai auto-resume] candidate scan failed for account ${cfg.account_id}:`,
        candErr.message,
      )
      continue
    }
    if (!candidates || candidates.length === 0) continue
    scanned += candidates.length

    for (const conv of candidates) {
      const { data: agentMessage } = await db
        .from('messages')
        .select('id')
        .eq('conversation_id', conv.id)
        .eq('sender_type', 'agent')
        .gt('created_at', conv.ai_paused_at as string)
        .limit(1)
        .maybeSingle()
      if (agentMessage) continue // a human replied without formally taking over

      const { error: updErr } = await db
        .from('conversations')
        .update({
          ai_autoreply_disabled: false,
          assigned_agent_id: null,
          ai_reply_count: 0,
          ai_handoff_summary: null,
          ai_paused_at: null,
        })
        .eq('id', conv.id)
      if (updErr) {
        console.error(
          `[ai auto-resume] resume failed for conversation ${conv.id}:`,
          updErr.message,
        )
        continue
      }
      resumed += 1
    }
  }

  return { scanned, resumed }
}
