import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { proxyInboundMedia, InboundMediaError } from '@/lib/whatsapp/inbound-media'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { archivedCopyForProxyUrl } from '@/lib/media/archive'

// ============================================================
// Proxies inbound WhatsApp media for Zernio-bridged accounts.
//
// Mirrors /api/whatsapp/media/[mediaId]/route.ts (the direct-Meta
// proxy) exactly in spirit: session-gated, resolve the caller's
// account, fetch the bytes server-side (so the Zernio API key never
// reaches the browser), stream them back.
//
// Unlike the Meta path, there's no bare media id to look up against a
// stored access token — Zernio's inbound attachment URL already
// carries everything needed, so the webhook adapter
// (webhook/zernio/route.ts) base64url-encodes that whole URL as
// `token`. The actual decode + host-validation + fetch lives in
// `downloadInboundMedia` (src/lib/whatsapp/inbound-media.ts), shared
// with voice transcription and image description so that
// security-sensitive logic exists in exactly one place.
// ============================================================

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params
    if (!token) {
      return NextResponse.json({ error: 'Media token is required' }, { status: 400 })
    }

    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Any signed-in account member may view inbox media — same bar as
    // the direct-Meta proxy (it doesn't check role beyond "has a
    // profile"). The Zernio API key itself is global to this instance,
    // not per-account, so it can't be used to scope the request — but
    // the `token` (the base64url-encoded Zernio attachment URL,
    // webhook/zernio/route.ts) is NOT a secret; anyone who guesses or
    // captures another account's token could otherwise fetch its
    // private media just by having any valid session here. Since
    // parseMessageContent() (webhook-processor.ts) stores this exact
    // "/api/whatsapp/media/zernio/<token>" string on the owning
    // message's `media_url`, confirm a message in the CALLER's own
    // account actually references this token before proxying anything.
    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle()
    if (!profile?.account_id) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 },
      )
    }

    const { data: owningMessage } = await supabase
      .from('messages')
      .select('id, conversations!inner(account_id)')
      .eq('media_url', `/api/whatsapp/media/zernio/${token}`)
      .eq('conversations.account_id', profile.account_id)
      .limit(1)
      .maybeSingle()
    if (!owningMessage) {
      return NextResponse.json({ error: 'Media not found' }, { status: 404 })
    }

    // Archived copy first (migration 111) — the provider's own copy
    // expires, the archived one doesn't.
    const archived = await archivedCopyForProxyUrl(supabase, supabaseAdmin(), `/api/whatsapp/media/zernio/${token}`)
    if (archived) {
      return NextResponse.redirect(archived, {
        status: 302,
        headers: { 'Cache-Control': 'private, max-age=1800' },
      })
    }

    // Forward the browser's Range header (video/audio scrubbing) and
    // stream the body straight through — see proxyInboundMedia's
    // header note on why this matters for video specifically.
    const media = await proxyInboundMedia({
      provider: 'zernio',
      mediaId: token,
      rangeHeader: request.headers.get('range'),
    })
    const headers = new Headers({
      'Content-Type': media.contentType,
      'Cache-Control': 'private, max-age=86400', // customer media — never cache in a shared CDN/proxy
      'Accept-Ranges': 'bytes',
    })
    if (media.contentRange) headers.set('Content-Range', media.contentRange)
    if (media.contentLength) headers.set('Content-Length', media.contentLength)
    return new Response(media.body, { status: media.status, headers })
  } catch (error) {
    if (error instanceof InboundMediaError) {
      console.error('[media/zernio]', error.message)
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('Error in Zernio media GET:', error)
    return NextResponse.json({ error: 'Failed to fetch media' }, { status: 500 })
  }
}
