import type { SupabaseClient } from '@supabase/supabase-js'
import { INBOUND_MEDIA_BUCKET } from './archive'

/**
 * Media retention (migration 119): for accounts that set
 * `media_retention_days`, delete the stored files of messages older
 * than that and mark them `media_expired_at`. Runs from the
 * archive-media cron, a bounded batch per account per run.
 */

const CHAT_MEDIA_BUCKET = 'chat-media'
const CHAT_MEDIA_MARKER = `/storage/v1/object/public/${CHAT_MEDIA_BUCKET}/`
/** Messages handled per account per run (the cron runs every 5 min). */
const BATCH = 200

export interface RetentionCandidate {
  id: string
  media_url: string | null
  media_storage_path: string | null
}

export type RetentionPlan =
  /** Delete this object and clear the message's media. */
  | { action: 'delete'; bucket: string; path: string }
  /** Provider link (Meta / Zernio proxy) that has expired anyway, nothing stored: clear it. */
  | { action: 'clear' }
  /** Someone else's asset (flow media, AI library, template header…): leave the file, stop scanning. */
  | { action: 'keep' }

/** What to do with one old message's media. Pure — unit-tested. */
export function planRetention(msg: RetentionCandidate): RetentionPlan {
  if (msg.media_storage_path) {
    return { action: 'delete', bucket: INBOUND_MEDIA_BUCKET, path: msg.media_storage_path }
  }
  const url = msg.media_url ?? ''
  const i = url.indexOf(CHAT_MEDIA_MARKER)
  if (i >= 0) {
    const path = decodeURIComponent(url.slice(i + CHAT_MEDIA_MARKER.length).split('?')[0])
    return path ? { action: 'delete', bucket: CHAT_MEDIA_BUCKET, path } : { action: 'keep' }
  }
  if (url.startsWith('/api/whatsapp/media/') || url.startsWith('/api/messages/')) {
    return { action: 'clear' }
  }
  return { action: 'keep' }
}

export async function runMediaRetention(
  db: SupabaseClient,
): Promise<{ accounts: number; filesDeleted: number; messagesExpired: number }> {
  const { data: accounts, error } = await db
    .from('accounts')
    .select('id, media_retention_days')
    .not('media_retention_days', 'is', null)
  if (error) {
    // Pre-119 database: no column → no retention configured anywhere.
    return { accounts: 0, filesDeleted: 0, messagesExpired: 0 }
  }

  let filesDeleted = 0
  let messagesExpired = 0
  for (const acct of (accounts ?? []) as { id: string; media_retention_days: number }[]) {
    try {
      const r = await purgeAccount(db, acct.id, acct.media_retention_days)
      filesDeleted += r.filesDeleted
      messagesExpired += r.messagesExpired
    } catch (err) {
      console.error('[media-retention] account', acct.id, 'failed:', err)
    }
  }
  return { accounts: accounts?.length ?? 0, filesDeleted, messagesExpired }
}

async function purgeAccount(
  db: SupabaseClient,
  accountId: string,
  days: number,
): Promise<{ filesDeleted: number; messagesExpired: number }> {
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString()
  const { data, error } = await db
    .from('messages')
    .select('id, media_url, media_storage_path, conversations!inner(account_id)')
    .eq('conversations.account_id', accountId)
    .not('media_url', 'is', null)
    .is('media_expired_at', null)
    .lt('created_at', cutoff)
    .order('created_at', { ascending: true })
    .limit(BATCH)
  if (error) {
    console.error('[media-retention] scan failed:', error.message)
    return { filesDeleted: 0, messagesExpired: 0 }
  }
  const rows = (data ?? []) as unknown as RetentionCandidate[]
  if (!rows.length) return { filesDeleted: 0, messagesExpired: 0 }

  const now = new Date().toISOString()
  const toDelete = new Map<string, Set<string>>() // bucket → paths
  const clearIds: string[] = []
  const keepIds: string[] = []

  for (const msg of rows) {
    const plan = planRetention(msg)
    if (plan.action === 'delete' && plan.bucket === CHAT_MEDIA_BUCKET) {
      // A chat-media file can be shared: a template header, or the same
      // attachment re-sent later. Only delete it when nothing still uses it.
      if (await chatMediaStillUsed(db, msg, cutoff)) {
        keepIds.push(msg.id)
        continue
      }
    }
    if (plan.action === 'delete') {
      const set = toDelete.get(plan.bucket) ?? new Set<string>()
      set.add(plan.path)
      toDelete.set(plan.bucket, set)
      clearIds.push(msg.id)
    } else if (plan.action === 'clear') {
      clearIds.push(msg.id)
    } else {
      keepIds.push(msg.id)
    }
  }

  let filesDeleted = 0
  for (const [bucket, paths] of toDelete) {
    const list = [...paths]
    for (let i = 0; i < list.length; i += 100) {
      const chunk = list.slice(i, i + 100)
      const { error: rmErr } = await db.storage.from(bucket).remove(chunk)
      if (rmErr) {
        // Leave these messages for the next run rather than pointing
        // them at nothing while the file still exists.
        console.error('[media-retention] removing files failed:', rmErr.message)
        return { filesDeleted, messagesExpired: 0 }
      }
      filesDeleted += chunk.length
    }
  }

  let messagesExpired = 0
  if (clearIds.length) {
    const { error: upErr } = await db
      .from('messages')
      .update({ media_url: null, media_storage_path: null, media_expired_at: now })
      .in('id', clearIds)
    if (upErr) console.error('[media-retention] marking messages failed:', upErr.message)
    else messagesExpired += clearIds.length
  }
  if (keepIds.length) {
    await db.from('messages').update({ media_expired_at: now }).in('id', keepIds)
  }
  return { filesDeleted, messagesExpired }
}

async function chatMediaStillUsed(db: SupabaseClient, msg: RetentionCandidate, cutoff: string): Promise<boolean> {
  const url = msg.media_url as string
  const [tpl, other] = await Promise.all([
    db.from('message_templates').select('id', { count: 'exact', head: true }).eq('header_media_url', url),
    db
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('media_url', url)
      .neq('id', msg.id)
      // A newer message (still inside the retention period) using it.
      .gte('created_at', cutoff),
  ])
  // On a lookup error, err on the side of keeping the file.
  if (tpl.error || other.error) return true
  return (tpl.count ?? 0) > 0 || (other.count ?? 0) > 0
}
