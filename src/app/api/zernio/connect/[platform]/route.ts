// ============================================================
// GET /api/zernio/connect/[platform] — start a Zernio OAuth connect
//
// The <ConnectPlatformButton> does a full-page `window.location.href`
// navigation here (never a fetch from the client — the ZERNIO_API_KEY
// must stay server-side). We:
//   1. Resolve the caller's account (admin+ only — connecting a
//      channel is a settings-class action, mirrors whatsapp_config).
//   2. Ensure a `client_zernio_accounts` row exists for this account,
//      using the account's own id (as text) as the Zernio `profileId`
//      — see migration 048 for why we don't mint a separate id.
//   3. Ask Zernio for an `authUrl` and redirect the browser there.
//
// Every failure path redirects back to Settings with `zernio_error`
// set (rather than returning raw JSON) so the button never spins
// forever — the page reload itself ends the "connecting" state, and
// IntegrationsPanel surfaces the reason as a toast.
// ============================================================

import { NextResponse, type NextRequest } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { requireRole } from '@/lib/auth/account'

const PLATFORMS = ['whatsapp', 'instagram'] as const
type Platform = (typeof PLATFORMS)[number]

function isPlatform(value: string): value is Platform {
  return (PLATFORMS as readonly string[]).includes(value)
}

// Outbound call to Zernio gets a hard timeout so a hung upstream can
// never leave the browser navigation (and therefore the button) stuck.
const ZERNIO_TIMEOUT_MS = 10_000

function settingsRedirect(
  origin: string,
  platform: string,
  outcome: { connected: false; error: string },
) {
  const url = new URL('/settings', origin)
  url.searchParams.set('tab', 'integrations')
  url.searchParams.set('zernio_platform', platform)
  url.searchParams.set('zernio_connected', '0')
  url.searchParams.set('zernio_error', outcome.error)
  return NextResponse.redirect(url)
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ platform: string }> },
) {
  const { platform: rawPlatform } = await params
  const origin = request.nextUrl.origin

  if (!isPlatform(rawPlatform)) {
    return settingsRedirect(origin, rawPlatform, {
      connected: false,
      error: `Unsupported platform "${rawPlatform}".`,
    })
  }
  const platform = rawPlatform

  let accountId: string
  let accountName: string
  try {
    // Connecting/disconnecting a channel is settings-class — same bar
    // as whatsapp_config, api keys, etc.
    const ctx = await requireRole('admin')
    accountId = ctx.accountId
    accountName = ctx.account.name
  } catch (err) {
    // No session / insufficient role. This route is only ever reached
    // via a click inside the (already auth-gated) settings page, so
    // this is a defensive fallback, not the primary UX path.
    const message = err instanceof Error ? err.message : 'Not authorized to connect a channel.'
    return settingsRedirect(origin, platform, { connected: false, error: message })
  }

  const apiKey = process.env.ZERNIO_API_KEY
  if (!apiKey) {
    console.error('[zernio/connect] ZERNIO_API_KEY is not set')
    return settingsRedirect(origin, platform, {
      connected: false,
      error: 'Zernio is not configured on this server.',
    })
  }

  // Zernio's own base URL, e.g. https://zernio.com. Kept overridable
  // for staging/sandbox environments; falls back to the documented
  // production host.
  const zernioBase = process.env.ZERNIO_API_BASE_URL || 'https://zernio.com'

  // Where Zernio should send the browser back to once the Meta OAuth
  // flow finishes. `?platform=` rides along on our own callback URL —
  // Zernio appends its own params (connected/profileId/accountId) to
  // whatever we hand it, so this is how the callback route learns
  // which column to write without needing a session at that point.
  const callbackBase =
    process.env.ZERNIO_REDIRECT_URL || `${origin}/api/zernio/callback`
  const redirectUrl = new URL(callbackBase)
  redirectUrl.searchParams.set('platform', platform)

  // Reuse the account's own id as the Zernio profileId — one Zernio
  // profile per wacrm account, no separate signup step needed.
  const zernioProfileId = accountId

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  // Make sure the row exists *before* sending the user to Meta, so the
  // callback (which has no session to fall back on) can always find it
  // by zernio_profile_id.
  const { error: upsertError } = await admin
    .from('client_zernio_accounts')
    .upsert(
      {
        account_id: accountId,
        client_name: accountName,
        zernio_profile_id: zernioProfileId,
      },
      { onConflict: 'account_id' },
    )

  if (upsertError) {
    console.error('[zernio/connect] upsert failed:', upsertError)
    return settingsRedirect(origin, platform, {
      connected: false,
      error: 'Could not prepare the connection. Please try again.',
    })
  }

  const zernioUrl = new URL(`/api/v1/connect/${platform}`, zernioBase)
  zernioUrl.searchParams.set('profileId', zernioProfileId)
  zernioUrl.searchParams.set('redirect_url', redirectUrl.toString())

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), ZERNIO_TIMEOUT_MS)

  try {
    const res = await fetch(zernioUrl, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      console.error('[zernio/connect] Zernio returned', res.status, detail)
      return settingsRedirect(origin, platform, {
        connected: false,
        error: `Zernio couldn't start the connection (${res.status}).`,
      })
    }

    const data = (await res.json()) as { authUrl?: string }
    if (!data.authUrl) {
      console.error('[zernio/connect] Zernio response missing authUrl:', data)
      return settingsRedirect(origin, platform, {
        connected: false,
        error: "Zernio didn't return a connection link.",
      })
    }

    return NextResponse.redirect(data.authUrl)
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'AbortError'
    console.error('[zernio/connect] request to Zernio failed:', err)
    return settingsRedirect(origin, platform, {
      connected: false,
      error: timedOut
        ? 'Zernio took too long to respond. Please try again.'
        : 'Could not reach Zernio. Please try again.',
    })
  } finally {
    clearTimeout(timeout)
  }
}
