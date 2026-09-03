// ============================================================
// GET /api/integrations/google-calendar/connect — start the Google
// Calendar OAuth flow.
//
// Same overall shape as /api/zernio/connect/[platform]: admin+ only,
// full-page redirect (never a fetch — nothing here should be callable
// cross-origin), every failure bounces back to Settings with an error
// param instead of returning raw JSON so a button never spins forever.
// ============================================================

import { NextResponse, type NextRequest } from 'next/server'
import { requireRole } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { getPublicOrigin } from '@/lib/http/request-origin'
import { buildAuthUrl, googleCalendarRedirectUri, GoogleOAuthError } from '@/lib/google-calendar/oauth'
import { signState } from '@/lib/google-calendar/state'

function settingsRedirect(origin: string, error: string) {
  const url = new URL('/settings', origin)
  url.searchParams.set('tab', 'integrations')
  url.searchParams.set('gcal_connected', '0')
  url.searchParams.set('gcal_error', error)
  return NextResponse.redirect(url)
}

export async function GET(request: NextRequest) {
  const origin = getPublicOrigin(request)

  let accountId: string
  let userId: string
  try {
    // Connecting an integration is settings-class, same bar as
    // whatsapp_config / the Zernio connects.
    const ctx = await requireRole('admin')
    accountId = ctx.accountId
    userId = ctx.userId
  } catch (err) {
    // No session / insufficient role — this route is only ever reached
    // via a click inside the (already auth-gated) settings page, so
    // this is a defensive fallback, not the primary UX path.
    const message = err instanceof Error ? err.message : 'Not authorized to connect Google Calendar.'
    return settingsRedirect(origin, message)
  }

  const limit = checkRateLimit(`gcal-connect:${userId}`, RATE_LIMITS.adminAction)
  if (!limit.success) return rateLimitResponse(limit)

  try {
    const state = signState(accountId)
    const authUrl = buildAuthUrl(state, googleCalendarRedirectUri(origin))
    return NextResponse.redirect(authUrl)
  } catch (err) {
    const message = err instanceof GoogleOAuthError ? err.message : 'Could not start the connection. Please try again.'
    console.error('[google-calendar/connect] failed:', err)
    return settingsRedirect(origin, message)
  }
}
