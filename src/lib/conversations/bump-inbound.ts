import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Record a new inbound message on its conversation: +1 unread, preview
 * text and timestamps, in ONE atomic UPDATE (the
 * `bump_conversation_on_inbound` RPC, migration 110).
 *
 * The webhooks used to write `unread_count = <value read earlier> + 1`,
 * which lost increments when two messages landed together and wrote a
 * stale count back over an agent who had just opened the thread.
 *
 * Falls back to that old read-modify-write when the RPC isn't deployed
 * yet, so shipping this ahead of the migration changes nothing.
 * Service-role client only.
 */
export async function bumpConversationOnInbound(
  db: SupabaseClient,
  args: { conversationId: string; preview: string; knownUnreadCount: number | null | undefined },
): Promise<void> {
  const { error } = await db.rpc('bump_conversation_on_inbound', {
    p_conversation_id: args.conversationId,
    p_preview: args.preview,
  })
  if (!error) return

  const missing =
    error.code === 'PGRST202' ||
    error.code === '42883' ||
    /could not find the function|does not exist/i.test(error.message ?? '')
  if (!missing) {
    console.error('[conversations] bump_conversation_on_inbound failed:', error.message)
  }

  const now = new Date().toISOString()
  const { error: updateErr } = await db
    .from('conversations')
    .update({
      last_message_text: args.preview,
      last_message_at: now,
      unread_count: (args.knownUnreadCount || 0) + 1,
      updated_at: now,
    })
    .eq('id', args.conversationId)
  if (updateErr) {
    console.error('[conversations] updating conversation on inbound failed:', updateErr.message)
  }
}
