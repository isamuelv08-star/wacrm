import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

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
// `token`. This route just decodes it, adds the Zernio auth header,
// and re-fetches.
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

    const apiKey = process.env.ZERNIO_API_KEY
    if (!apiKey) {
      console.error('[media/zernio] ZERNIO_API_KEY is not set')
      return NextResponse.json({ error: 'Zernio is not configured' }, { status: 500 })
    }

    let mediaUrl: string
    try {
      mediaUrl = Buffer.from(token, 'base64url').toString('utf8')
    } catch {
      return NextResponse.json({ error: 'Invalid media token' }, { status: 400 })
    }

    // Defense in depth: the token is server-generated (base64url of a
    // URL Zernio itself gave us in a signed webhook), but decoding
    // arbitrary base64 into a fetch target is exactly the shape of an
    // SSRF bug if that assumption is ever wrong — so only proceed
    // when it actually decodes to a Zernio host.
    let parsed: URL
    try {
      parsed = new URL(mediaUrl)
    } catch {
      return NextResponse.json({ error: 'Invalid media token' }, { status: 400 })
    }
    const isZernioHost =
      parsed.hostname === 'zernio.com' || parsed.hostname.endsWith('.zernio.com')
    if (!isZernioHost || parsed.protocol !== 'https:') {
      return NextResponse.json({ error: 'Invalid media token' }, { status: 400 })
    }

    const upstream = await fetch(parsed.toString(), {
      headers: { Authorization: `Bearer ${apiKey}` },
    })

    if (!upstream.ok) {
      console.error('[media/zernio] upstream fetch failed:', upstream.status)
      return NextResponse.json({ error: 'Failed to fetch media' }, { status: 502 })
    }

    const buffer = await upstream.arrayBuffer()
    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream',
        'Cache-Control': 'public, max-age=86400',
      },
    })
  } catch (error) {
    console.error('Error in Zernio media GET:', error)
    return NextResponse.json({ error: 'Failed to fetch media' }, { status: 500 })
  }
}
