import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseAdmin } from './admin-client'
import { isMissingColumnError } from '@/lib/whatsapp/external-outbound'

/**
 * Who owns a conversation — the bot or a person — expressed as the two
 * writes/reads that decide it outside of `loadAiConfig`'s full load.
 */

/**
 * `ai_configs.ai_reply_when_assigned` (migration 102) on its own, for
 * the two callers that only need this one flag and have no reason to
 * load and decrypt the whole AI config. Defaults to true — the bot
 * answers assigned threads — including when the account has no AI
 * config at all or the migration hasn't been applied yet.
 */
export async function readReplyWhenAssigned(
  db: SupabaseClient,
  accountId: string,
): Promise<boolean> {
  const { data, error } = await db
    .from('ai_configs')
    .select('ai_reply_when_assigned')
    .eq('account_id', accountId)
    .maybeSingle()
  if (error) {
    if (!isMissingColumnError(error)) {
      console.error('[ai] reading ai_reply_when_assigned failed:', error.message)
    }
    return true
  }
  return (data as { ai_reply_when_assigned?: boolean } | null)?.ai_reply_when_assigned !== false
}

/**
 * "A seller wrote here" ⇒ the bot stops answering this thread.
 *
 * Until migration 102 the bot stood down on any conversation with an
 * `assigned_agent_id`, which sounds like the same thing but isn't:
 * round-robin (migration 042) stamps an assignee on every brand-new
 * conversation before a human has read a word of it, so the bot went
 * quiet on every new lead. Assignment now only routes; *replying* is
 * what takes the thread away from the bot — which is also the rule a
 * human would use.
 *
 * Writes exactly the state the inbox's "Take over" button writes
 * (`ai_autoreply_disabled` + `ai_paused_at`), so:
 *   - the chat banner and the sidebar switch already render it,
 *   - "Resume AI" already undoes it (and clears `ai_paused_at`),
 *   - the opt-in auto-resume scan (auto-resume.ts) hands the thread
 *     back on its own once the seller has been quiet for the account's
 *     `auto_resume_after_minutes`.
 *
 * Call it only for messages a HUMAN sent — never for the bot's own
 * replies, a flow step, or an automation, or the bot would mute itself
 * the instant it answered. Best-effort and never throws: a send must
 * not fail because this bookkeeping did.
 */
export async function pauseAiForAgentReply(args: {
  accountId: string
  conversationId: string
}): Promise<void> {
  const { accountId, conversationId } = args

  try {
    const db = supabaseAdmin()

    // Read the switch on its own (not through loadAiConfig) so this
    // costs one narrow query on a hot send path, and so an account with
    // no AI configured at all simply no-ops. A database without
    // migration 102 errors here and is treated as "leave it alone".
    const { data: cfg, error: cfgErr } = await db
      .from('ai_configs')
      .select('ai_pause_on_agent_reply')
      .eq('account_id', accountId)
      .maybeSingle()
    if (cfgErr || !cfg) return
    if ((cfg as { ai_pause_on_agent_reply?: boolean }).ai_pause_on_agent_reply === false) return

    const { error } = await db
      .from('conversations')
      .update({
        ai_autoreply_disabled: true,
        ai_paused_at: new Date().toISOString(),
      })
      .eq('id', conversationId)
      .eq('account_id', accountId)
    if (error) {
      console.error('[ai] pause-on-agent-reply failed:', error.message)
    }
  } catch (err) {
    console.error(
      '[ai] pause-on-agent-reply threw:',
      err instanceof Error ? err.message : err,
    )
  }
}
