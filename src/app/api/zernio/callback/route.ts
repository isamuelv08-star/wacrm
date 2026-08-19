// ============================================================
// GET /api/zernio/callback — Zernio OAuth return leg
//
// Zernio redirects the browser here once the customer finishes (or
// cancels) the Meta connect flow, appending its own query params to
// the `redirect_url` we gave it in /api/zernio/connect/[platform]
// (which already carries `?platform=`).
//
// Deliberately does NOT require a Supabase session: this is a
// server-to-browser redirect chain through Meta and Zernio, and
// there's no guarantee the original session cookie survives that
// round trip intact. `profileId` (Zernio's own id, minted via POST
// /v1/profiles and stored on client_zernio_accounts — see migration
// 048 and the connect route) is enough to find the right row with
// the service-role client, independent of whoever's browser it is.
// ============================================================

import { NextResponse, type NextRequest } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { getPublicOrigin } from '@/lib/http/request-origin'

const PLATFORMS = ['whatsapp', 'instagram'] as const
type Platform = (typeof PLATFORMS)[number]

function isPlatform(value: string | null): value is Platform {
  return !!value && (PLATFORMS as readonly string[]).includes(value)
}

function settingsRedirect(
  origin: string,
  platform: string | null,
  outcome: { connected: boolean; error?: string },
) {
  const url = new URL('/settings', origin)
  url.searchParams.set('tab', 'integrations')
  if (platform) url.searchParams.set('zernio_platform', platform)
  url.searchParams.set('zernio_connected', outcome.connected ? '1' : '0')
  if (outcome.error) url.searchParams.set('zernio_error', outcome.error)
  return NextResponse.redirect(url)
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  // NOT request.nextUrl.origin — see the comment in
  // /api/zernio/connect/[platform]/route.ts. Same proxy problem
  // applies here since this route also redirects the browser.
  const origin = getPublicOrigin(request)
  const platform = searchParams.get('platform')

  // Meta cancellation or a Zernio-side failure surfaces as an
  // `error`/`error_description` pair instead of `connected=true`.
  const upstreamError = searchParams.get('error')
  const upstreamErrorDescription = searchParams.get('error_description')

  if (!isPlatform(platform)) {
    return settingsRedirect(origin, platform, {
      connected: false,
      error: 'Zernio callback is missing a valid platform.',
    })
  }

  if (upstreamError) {
    return settingsRedirect(origin, platform, {
      connected: false,
      error: upstreamErrorDescription || upstreamError,
    })
  }

  const connected = searchParams.get('connected') === 'true'
  const profileId = searchParams.get('profileId')
  const accountId = searchParams.get('accountId')

  if (!connected) {
    return settingsRedirect(origin, platform, {
      connected: false,
      error: 'The connection was not completed.',
    })
  }

  if (!profileId || !accountId) {
    console.error('[zernio/callback] missing profileId/accountId', {
      platform,
      profileId,
      accountId,
    })
    return settingsRedirect(origin, platform, {
      connected: false,
      error: 'Zernio callback is missing required data.',
    })
  }

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const column =
    platform === 'whatsapp' ? 'whatsapp_account_id' : 'instagram_account_id'

  const { data, error } = await admin
    .from('client_zernio_accounts')
    .update({
      [column]: accountId,
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('zernio_profile_id', profileId)
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('[zernio/callback] update failed:', error)
    return settingsRedirect(origin, platform, {
      connected: false,
      error: 'Could not save the connection. Please try again.',
    })
  }

  if (!data) {
    // No row for this profileId — the connect step never ran, or the
    // account was deleted in between. Either way there's nothing to
    // attach this connection to.
    console.error('[zernio/callback] no matching row for profileId', profileId)
    return settingsRedirect(origin, platform, {
      connected: false,
      error: 'No matching account found for this connection.',
    })
  }

  return settingsRedirect(origin, platform, { connected: true })
}
