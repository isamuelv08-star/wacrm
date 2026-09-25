import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { signedArchivedMediaUrl } from '@/lib/media/archive'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * GET /api/messages/:id/media — durable URL for an archived inbound
 * media file (migration 111). Used as media_url for media whose
 * original provider URL expires (Messenger CDN).
 *
 * The message is read through the caller's RLS client, so only someone
 * who can see the message can get its file; the private bucket is then
 * signed with the service role and the browser is redirected (Storage
 * serves Range requests, so video/audio seeking works).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

    const ctx = await getCurrentAccount()
    const { data: message } = await ctx.supabase
      .from('messages')
      .select('id, media_storage_path')
      .eq('id', id)
      .maybeSingle()
    if (!message) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const signed = await signedArchivedMediaUrl(supabaseAdmin(), message.media_storage_path as string | null)
    if (!signed) return NextResponse.json({ error: 'Media not available' }, { status: 404 })

    return NextResponse.redirect(signed, {
      status: 302,
      headers: { 'Cache-Control': 'private, max-age=1800' },
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
