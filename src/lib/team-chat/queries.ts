import type { SupabaseClient } from '@supabase/supabase-js'

type DB = SupabaseClient

export interface TeamChatMessage {
  id: string
  accountId: string
  senderUserId: string
  body: string
  mentionedUserIds: string[]
  referencedConversationId: string | null
  createdAt: string
}

interface MessageRow {
  id: string
  account_id: string
  sender_user_id: string
  body: string
  mentioned_user_ids: string[] | null
  referenced_conversation_id: string | null
  created_at: string
}

function fromRow(row: MessageRow): TeamChatMessage {
  return {
    id: row.id,
    accountId: row.account_id,
    senderUserId: row.sender_user_id,
    body: row.body,
    mentionedUserIds: row.mentioned_user_ids ?? [],
    referencedConversationId: row.referenced_conversation_id,
    createdAt: row.created_at,
  }
}

const PAGE_SIZE = 50

/**
 * Most recent messages first (for the initial load / "load older"
 * cursor), returned in ascending (oldest-first) order — the shape the
 * message list actually renders in. `beforeCreatedAt` pages backward
 * from a cursor for "load older" instead of offset pagination, same
 * reasoning as the v1 API's keyset pages (src/lib/api/v1/pagination.ts)
 * — offsets drift under a live, constantly-appending table.
 */
export async function loadTeamChatMessages(
  db: DB,
  accountId: string,
  beforeCreatedAt?: string,
): Promise<TeamChatMessage[]> {
  let q = db
    .from('team_chat_messages')
    .select('id, account_id, sender_user_id, body, mentioned_user_ids, referenced_conversation_id, created_at')
    .eq('account_id', accountId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(PAGE_SIZE)
  if (beforeCreatedAt) q = q.lt('created_at', beforeCreatedAt)

  const { data, error } = await q
  if (error) throw error
  return ((data ?? []) as MessageRow[]).map(fromRow).reverse()
}

export async function sendTeamChatMessage(
  db: DB,
  params: {
    accountId: string
    senderUserId: string
    body: string
    mentionedUserIds: string[]
    referencedConversationId: string | null
  },
): Promise<TeamChatMessage> {
  const { data, error } = await db
    .from('team_chat_messages')
    .insert({
      account_id: params.accountId,
      sender_user_id: params.senderUserId,
      body: params.body,
      mentioned_user_ids: params.mentionedUserIds,
      referenced_conversation_id: params.referencedConversationId,
    })
    .select('id, account_id, sender_user_id, body, mentioned_user_ids, referenced_conversation_id, created_at')
    .single()
  if (error) throw error
  return fromRow(data as MessageRow)
}

/** Soft-delete — sender or admin+ only, enforced by RLS (090). */
export async function deleteTeamChatMessage(db: DB, messageId: string): Promise<void> {
  const { error } = await db
    .from('team_chat_messages')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', messageId)
  if (error) throw error
}

/** Advances the caller's own read watermark — drives the sidebar's
 *  unread dot the same way opening the notifications page clears it. */
export async function markTeamChatRead(db: DB, userId: string): Promise<void> {
  const { error } = await db
    .from('profiles')
    .update({ team_chat_last_read_at: new Date().toISOString() })
    .eq('user_id', userId)
  if (error) throw error
}

/**
 * Unread count for the sidebar nav dot — messages from anyone else,
 * created after the caller's own `team_chat_last_read_at` (null means
 * "never read", i.e. everything so far). Capped display-side by the
 * caller (same "9+" treatment as the inbox's own unread badges), this
 * just returns the real count.
 */
export async function loadTeamChatUnreadCount(
  db: DB,
  accountId: string,
  userId: string,
  lastReadAt: string | null,
): Promise<number> {
  let q = db
    .from('team_chat_messages')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .neq('sender_user_id', userId)
    .is('deleted_at', null)
  if (lastReadAt) q = q.gt('created_at', lastReadAt)

  const { count, error } = await q
  if (error) throw error
  return count ?? 0
}
