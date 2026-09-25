import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import { downloadInboundMedia } from '@/lib/whatsapp/inbound-media'

/** Private bucket created by migration 111. */
export const INBOUND_MEDIA_BUCKET = 'inbound-media'
const MAX_BYTES = 100 * 1024 * 1024
const DIRECT_FETCH_TIMEOUT_MS = 60_000

const META_PROXY_PREFIX = '/api/whatsapp/media/'
const ZERNIO_PROXY_PREFIX = '/api/whatsapp/media/zernio/'

/** Durable route for media whose original URL expires (Messenger CDN). */
export function storedMediaRoute(messageId: string): string {
  return `/api/messages/${messageId}/media`
}

type MediaSource =
  | { kind: 'meta'; mediaId: string }
  | { kind: 'zernio'; token: string }
  | { kind: 'url'; url: string }

/** Where a message's media can be downloaded from, judged by its media_url. */
export function mediaSourceFromUrl(mediaUrl: string): MediaSource | null {
  if (mediaUrl.startsWith(ZERNIO_PROXY_PREFIX)) {
    const token = mediaUrl.slice(ZERNIO_PROXY_PREFIX.length)
    return token ? { kind: 'zernio', token } : null
  }
  if (mediaUrl.startsWith(META_PROXY_PREFIX)) {
    const mediaId = mediaUrl.slice(META_PROXY_PREFIX.length)
    return mediaId && !mediaId.includes('/') ? { kind: 'meta', mediaId } : null
  }
  if (/^https:\/\//i.test(mediaUrl)) return { kind: 'url', url: mediaUrl }
  return null
}

function extensionFor(mimeType: string): string {
  const sub = mimeType.split(';')[0].split('/')[1] ?? 'bin'
  return sub.replace(/[^a-z0-9.+-]/gi, '').slice(0, 20) || 'bin'
}

async function downloadDirect(url: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const res = await fetch(url, { signal: AbortSignal.timeout(DIRECT_FETCH_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`media download failed: ${res.status}`)
  const declared = Number(res.headers.get('content-length') ?? 0)
  if (declared > MAX_BYTES) throw new Error('media too large to archive')
  const buffer = Buffer.from(await res.arrayBuffer())
  return { buffer, mimeType: res.headers.get('content-type') ?? 'application/octet-stream' }
}

/**
 * Copy one inbound message's media into the private `inbound-media`
 * bucket and record its path. Customer media only; already-archived
 * rows are a no-op. Best-effort and never throws — returns whether the
 * message now has an archived copy. Service-role client only.
 *
 * Used inline by the webhooks right after a media message is stored,
 * and by the archive-media backfill cron for anything that missed it.
 */
export async function archiveMessageMedia(db: SupabaseClient, messageId: string): Promise<boolean> {
  try {
    const { data: msg, error } = await db
      .from('messages')
      .select('id, conversation_id, sender_type, media_url, media_storage_path, conversation:conversations(account_id, whatsapp_config_id)')
      .eq('id', messageId)
      .maybeSingle()
    if (error) {
      // Pre-111 database: no column yet — nothing to archive into.
      if (!/media_storage_path/.test(error.message)) {
        console.error('[media-archive] message lookup failed:', error.message)
      }
      return false
    }
    if (!msg || !msg.media_url) return false
    if (msg.media_storage_path) return true
    if (msg.sender_type !== 'customer') return false

    const conv = (Array.isArray(msg.conversation) ? msg.conversation[0] : msg.conversation) as
      | { account_id: string; whatsapp_config_id: string | null }
      | null
    if (!conv) return false

    const source = mediaSourceFromUrl(msg.media_url as string)
    if (!source) return false

    let buffer: Buffer
    let mimeType: string
    if (source.kind === 'url') {
      ;({ buffer, mimeType } = await downloadDirect(source.url))
    } else if (source.kind === 'zernio') {
      ;({ buffer, mimeType } = await downloadInboundMedia({ provider: 'zernio', mediaId: source.token }))
    } else {
      const accessToken = await metaAccessToken(db, conv.account_id, conv.whatsapp_config_id)
      if (!accessToken) return false
      ;({ buffer, mimeType } = await downloadInboundMedia({
        provider: 'meta',
        mediaId: source.mediaId,
        accessToken,
      }))
    }
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_BYTES) return false

    const path = `${conv.account_id}/${msg.conversation_id}/${msg.id}.${extensionFor(mimeType)}`
    const { error: uploadErr } = await db.storage
      .from(INBOUND_MEDIA_BUCKET)
      .upload(path, buffer, { contentType: mimeType, upsert: true })
    if (uploadErr) {
      console.error('[media-archive] upload failed:', uploadErr.message)
      return false
    }

    const update: Record<string, unknown> = { media_storage_path: path }
    // A raw provider URL (Messenger CDN) expires — point the inbox at our
    // durable route instead. Proxy URLs stay as they are: their routes
    // check media_storage_path first.
    if (source.kind === 'url') update.media_url = storedMediaRoute(msg.id)
    const { error: markErr } = await db.from('messages').update(update).eq('id', msg.id)
    if (markErr) {
      console.error('[media-archive] recording the path failed:', markErr.message)
      return false
    }
    return true
  } catch (err) {
    console.error('[media-archive] archiving message', messageId, 'failed:', err)
    return false
  }
}

async function metaAccessToken(
  db: SupabaseClient,
  accountId: string,
  whatsappConfigId: string | null,
): Promise<string | null> {
  let q = db.from('whatsapp_config').select('access_token').eq('account_id', accountId)
  q = whatsappConfigId ? q.eq('id', whatsappConfigId) : q.order('created_at', { ascending: true })
  const { data } = await q.limit(1).maybeSingle()
  if (!data?.access_token) return null
  try {
    return decrypt(data.access_token as string)
  } catch {
    return null
  }
}

/**
 * If this message's media has been archived, a short-lived signed URL
 * to it (to redirect the browser to); otherwise null. `db` must be the
 * service-role client — the bucket has no client policies.
 */
export async function signedArchivedMediaUrl(
  db: SupabaseClient,
  storagePath: string | null | undefined,
): Promise<string | null> {
  if (!storagePath) return null
  const { data, error } = await db.storage
    .from(INBOUND_MEDIA_BUCKET)
    .createSignedUrl(storagePath, 60 * 60)
  if (error || !data?.signedUrl) {
    console.error('[media-archive] signing failed:', error?.message)
    return null
  }
  return data.signedUrl
}

/**
 * For the media proxy routes: if the message behind this proxy
 * media_url has been archived, a signed URL to the stored copy (the
 * provider's own copy may have expired). `userDb` is the caller's RLS
 * client — the lookup only finds messages the caller can see; signing
 * uses the service role. Null when not archived (or before migration
 * 111), so the route falls back to proxying the provider.
 */
export async function archivedCopyForProxyUrl(
  userDb: SupabaseClient,
  adminDb: SupabaseClient,
  mediaUrl: string,
): Promise<string | null> {
  const { data, error } = await userDb
    .from('messages')
    .select('media_storage_path')
    .eq('media_url', mediaUrl)
    .not('media_storage_path', 'is', null)
    .limit(1)
    .maybeSingle()
  if (error || !data) return null
  return signedArchivedMediaUrl(adminDb, data.media_storage_path as string)
}

/** Meta keeps inbound media ~30 days; don't bother with anything older. */
const BACKFILL_WINDOW_DAYS = 28
const BACKFILL_BATCH = 40

/**
 * Archive recent customer media that the inline copy missed (a failed
 * download, a restart mid-webhook, or media that arrived before
 * migration 111). Newest first, a bounded batch per run.
 */
export async function runMediaArchiveBackfill(
  db: SupabaseClient,
): Promise<{ scanned: number; archived: number }> {
  const since = new Date(Date.now() - BACKFILL_WINDOW_DAYS * 86_400_000).toISOString()
  const { data, error } = await db
    .from('messages')
    .select('id')
    .eq('sender_type', 'customer')
    .not('media_url', 'is', null)
    .is('media_storage_path', null)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(BACKFILL_BATCH)
  if (error) {
    console.error('[media-archive] backfill scan failed:', error.message)
    return { scanned: 0, archived: 0 }
  }
  let archived = 0
  for (const row of (data ?? []) as { id: string }[]) {
    if (await archiveMessageMedia(db, row.id)) archived++
  }
  return { scanned: data?.length ?? 0, archived }
}
