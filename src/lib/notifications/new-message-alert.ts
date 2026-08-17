import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveOwnersAndAdmins } from './recipients'

// ============================================================
// Real-time popup + tray notification for every inbound customer
// message (migration 045). Called from webhook-processor.ts's
// processMessage right after the message row lands — best-effort,
// own try/catch, never blocks the inbound webhook's 200 OK.
//
// Goes to the conversation's assigned agent if it has one; otherwise
// every owner/admin, same fallback as hot-lead-alerts.ts and the
// deal-lifecycle triggers (043/044).
// ============================================================
export async function notifyNewMessage(
  db: SupabaseClient,
  args: {
    accountId: string
    conversationId: string
    contactId: string
    contactName: string | null
    contactPhone: string
    assignedAgentId: string | null
    preview: string
  },
): Promise<void> {
  try {
    const recipients = args.assignedAgentId
      ? [args.assignedAgentId]
      : await resolveOwnersAndAdmins(db, args.accountId)
    if (recipients.length === 0) return

    const contactLabel = args.contactName || args.contactPhone
    const { error } = await db.from('notifications').insert(
      recipients.map((userId) => ({
        account_id: args.accountId,
        user_id: userId,
        type: 'new_message' as const,
        conversation_id: args.conversationId,
        contact_id: args.contactId,
        title: `New message from ${contactLabel}`,
        body: args.preview,
      })),
    )
    if (error) {
      console.error('[new-message-alert] notification insert failed:', error.message)
    }
  } catch (err) {
    console.error('[new-message-alert] notifyNewMessage failed:', err)
  }
}
