import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { decrypt } from '@/lib/whatsapp/encryption'
import { proxyInboundMedia, InboundMediaError } from '@/lib/whatsapp/inbound-media'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ mediaId: string }> }
) {
  try {
    const { mediaId } = await params

    if (!mediaId) {
      return NextResponse.json(
        { error: 'Media ID is required' },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Resolve the caller's account_id — whatsapp_config is one-per-
    // account post-multi-user, so a teammate fetching media for a
    // conversation in the shared inbox needs the account's config,
    // not their personal (non-existent) row.
    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle()
    const accountId = profile?.account_id as string | undefined
    if (!accountId) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 },
      )
    }

    // Fetch and decrypt WhatsApp config
    const { data: config, error: configError } = await supabase
      .from('whatsapp_config')
      .select('*')
      .eq('account_id', accountId)
      .single()

    if (configError || !config) {
      return NextResponse.json(
        { error: 'WhatsApp not configured' },
        { status: 400 }
      )
    }

    const accessToken = decrypt(config.access_token)

    // Forward the browser's Range header (video/audio scrubbing) and
    // stream the body straight through instead of buffering the whole
    // file server-side first — see proxyInboundMedia's header note.
    const media = await proxyInboundMedia({
      provider: 'meta',
      mediaId,
      accessToken,
      rangeHeader: request.headers.get('range'),
    })
    const headers = new Headers({
      'Content-Type': media.contentType,
      'Cache-Control': 'public, max-age=86400',
      'Accept-Ranges': 'bytes',
    })
    if (media.contentRange) headers.set('Content-Range', media.contentRange)
    if (media.contentLength) headers.set('Content-Length', media.contentLength)
    return new Response(media.body, { status: media.status, headers })
  } catch (error) {
    if (error instanceof InboundMediaError) {
      console.error('[media]', error.message)
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('Error in WhatsApp media GET:', error)
    return NextResponse.json(
      { error: 'Failed to fetch media' },
      { status: 500 }
    )
  }
}
