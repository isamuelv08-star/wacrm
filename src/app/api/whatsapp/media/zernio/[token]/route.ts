import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { downloadInboundMedia, InboundMediaError } from '@/lib/whatsapp/inbound-media'

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
    // profile"). The account itself isn't otherwise used below since
    // the Zernio API key is global to this instance, not per-account;
    // this check just confirms the caller is a real logged-in user.
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

    const { buffer, mimeType } = await downloadInboundMedia({ provider: 'zernio', mediaId: token })
    // `new Uint8Array(buffer)` copies into a plain-ArrayBuffer-backed
    // view — a Node Buffer's underlying ArrayBufferLike can widen to
    // SharedArrayBuffer, which Response's BodyInit typing rejects
    // directly (same issue noted in src/lib/whatsapp/encryption.ts).
    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': mimeType,
        'Cache-Control': 'public, max-age=86400',
      },
    })
  } catch (error) {
    if (error instanceof InboundMediaError) {
      console.error('[media/zernio]', error.message)
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('Error in Zernio media GET:', error)
    return NextResponse.json({ error: 'Failed to fetch media' }, { status: 500 })
  }
}
