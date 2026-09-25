import type { SupabaseClient } from '@supabase/supabase-js'
import type { Automation } from '@/types'
import { triggerMatches } from './engine'

/** Step types that send something to the customer. */
const SENDING_STEP_TYPES = ['send_message', 'send_buttons', 'send_list', 'send_template']

/**
 * Will a user-built automation answer the customer's latest message
 * itself? The AI auto-reply (and the observer, which must agree with
 * it) stands down only in that case, to avoid double-texting.
 *
 * This used to be "does the account have ANY active
 * keyword_match / new_message_received automation" — so a single
 * keyword automation ("catálogo"), or a new_message_received one that
 * only adds a tag, silenced the AI on every message of every thread.
 * Now it has to (a) match this message and (b) actually send something.
 *
 * Automations only run from the WhatsApp webhook, so on any other
 * channel nothing will answer and the AI must not stand down.
 */
export async function hasMatchingAutoResponder(
  db: SupabaseClient,
  args: { accountId: string; conversationId: string; platform: string },
): Promise<boolean> {
  if (args.platform !== 'whatsapp') return false

  const { data: automations, error } = await db
    .from('automations')
    .select('id, trigger_type, trigger_config')
    .eq('account_id', args.accountId)
    .eq('is_active', true)
    .in('trigger_type', ['new_message_received', 'keyword_match'])
  if (error) {
    // Fail toward answering: a silent AI is the worse failure here.
    console.error('[automations] responder lookup failed:', error.message)
    return false
  }
  if (!automations || automations.length === 0) return false

  // The latest customer text — the same message the automations engine
  // matched against when it was dispatched for this inbound.
  const { data: latest } = await db
    .from('messages')
    .select('content_text')
    .eq('conversation_id', args.conversationId)
    .eq('sender_type', 'customer')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const messageText = (latest?.content_text as string | null) ?? ''

  const matchedIds = (automations as Pick<Automation, 'id' | 'trigger_type' | 'trigger_config'>[])
    .filter((a) => triggerMatches(a as Automation, { message_text: messageText }))
    .map((a) => a.id)
  if (matchedIds.length === 0) return false

  const { data: sendingStep, error: stepsErr } = await db
    .from('automation_steps')
    .select('id')
    .in('automation_id', matchedIds)
    .in('step_type', SENDING_STEP_TYPES)
    .limit(1)
    .maybeSingle()
  if (stepsErr) {
    console.error('[automations] responder steps lookup failed:', stepsErr.message)
    return false
  }
  return Boolean(sendingStep)
}
