// ============================================================
// /api/ai/media-library
//
//   GET  — list the account's catalog. Any member (so the inbox/
//          settings can show what's available, mirrors /api/ai/config).
//   POST — add an item (admin+). The file itself is uploaded straight
//          from the browser to the `ai-media-library` Storage bucket
//          (see uploadAccountMedia, src/lib/storage/upload-media.ts —
//          same client-side-upload pattern the Flows builder and inbox
//          composer already use) BEFORE this is called; this route only
//          persists the resulting metadata row.
// ============================================================

import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

const KEY_PATTERN = /^[a-z0-9_-]{1,60}$/
const MEDIA_KINDS = ['image', 'video', 'document'] as const
type MediaKind = (typeof MEDIA_KINDS)[number]

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const { data, error } = await supabase
      .from('ai_media_library')
      .select('id, key, title, description, media_kind, media_url, created_at')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
    if (error) {
      console.error('[ai/media-library GET] fetch error:', error)
      return NextResponse.json({ error: 'Failed to load media library' }, { status: 500 })
    }
    return NextResponse.json({ items: data ?? [] })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    const limit = checkRateLimit(`ai-media-library:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return bad('Invalid request body')

    const key = typeof body.key === 'string' ? body.key.trim().toLowerCase() : ''
    if (!KEY_PATTERN.test(key)) {
      return bad('key must be 1-60 characters: lowercase letters, numbers, "_" or "-"')
    }
    const title = typeof body.title === 'string' ? body.title.trim() : ''
    if (!title) return bad('title is required')
    const description = typeof body.description === 'string' ? body.description.trim() : ''
    if (!description) return bad('description is required')
    const mediaKind = body.media_kind as MediaKind
    if (!MEDIA_KINDS.includes(mediaKind)) {
      return bad(`media_kind must be one of: ${MEDIA_KINDS.join(', ')}`)
    }
    const mediaUrl = typeof body.media_url === 'string' ? body.media_url.trim() : ''
    if (!mediaUrl) return bad('media_url is required')
    const storagePath = typeof body.storage_path === 'string' ? body.storage_path.trim() : ''
    if (!storagePath) return bad('storage_path is required')

    const { data, error } = await supabase
      .from('ai_media_library')
      .insert({
        account_id: accountId,
        created_by: userId,
        key,
        title,
        description,
        media_kind: mediaKind,
        media_url: mediaUrl,
        storage_path: storagePath,
      })
      .select('id, key, title, description, media_kind, media_url, created_at')
      .single()

    if (error) {
      // Unique violation on (account_id, key).
      if (error.code === '23505') {
        return bad(`"${key}" is already used by another item — pick a different key.`)
      }
      console.error('[ai/media-library POST] insert error:', error)
      return NextResponse.json({ error: 'Failed to save the item' }, { status: 500 })
    }

    return NextResponse.json({ item: data })
  } catch (err) {
    return toErrorResponse(err)
  }
}
