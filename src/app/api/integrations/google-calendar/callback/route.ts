// ============================================================
// GET /api/integrations/google-calendar/callback — Google OAuth
// return leg.
//
// Unlike the Zernio callback (which deliberately skips re-checking
// the session because Zernio's own redirect chain might not carry
// cookies through reliably), this one goes straight admin's-browser →
// Google → back here with no broker in between, so re-validating the
// live session is both possible and the right defense: it's what lets
// the `state` check below actually prevent OAuth CSRF instead of just
// detecting tampering after the fact.
// ============================================================

import { NextResponse, type NextRequest } from 'next/server'
import { requireRole } from '@/lib/auth/account'
import { getPublicOrigin } from '@/lib/http/request-origin'
import {
  exchangeCodeForTokens,
  fetchGoogleEmail,
  googleCalendarRedirectUri,
  GoogleOAuthError,
} from '@/lib/google-calendar/oauth'
import { verifyState } from '@/lib/google-calendar/state'
import { upsertConnection } from '@/lib/google-calendar/connection'

function settingsRedirect(origin: string, outcome: { connected: boolean; error?: string }) {
  const url = new URL('/settings', origin)
  url.searchParams.set('tab', 'integrations')
  url.searchParams.set('gcal_connected', outcome.connected ? '1' : '0')
  if (outcome.error) url.searchParams.set('gcal_error', outcome.error)
  return NextResponse.redirect(url)
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const origin = getPublicOrigin(request)

  const upstreamError = searchParams.get('error')
  if (upstreamError) {
    // The user cancelled the Google consent screen, or Google itself
    // rejected the request — either way there's no code to exchange.
    return settingsRedirect(origin, { connected: false, error: upstreamError })
  }

  const code = searchParams.get('code')
  const state = searchParams.get('state')
  if (!code || !state) {
    return settingsRedirect(origin, { connected: false, error: 'Google callback is missing required data.' })
  }

  const stateAccountId = verifyState(state)
  if (!stateAccountId) {
    return settingsRedirect(origin, { connected: false, error: 'This connection link expired or is invalid. Please try again.' })
  }

  try {
    const ctx = await requireRole('admin')

    // The account that started the flow must be the one finishing it —
    // closes the OAuth-CSRF window described in state.ts's header note.
    if (stateAccountId !== ctx.accountId) {
      console.error('[google-calendar/callback] state accountId mismatch', {
        stateAccountId,
        accountId: ctx.accountId,
      })
      return settingsRedirect(origin, { connected: false, error: 'This connection link is not valid for your account.' })
    }

    const tokens = await exchangeCodeForTokens(code, googleCalendarRedirectUri(origin))
    const googleEmail = await fetchGoogleEmail(tokens.accessToken)
    await upsertConnection(ctx.supabase, ctx.accountId, ctx.userId, googleEmail, tokens)

    return settingsRedirect(origin, { connected: true })
  } catch (err) {
    const message =
      err instanceof GoogleOAuthError
        ? err.message
        : err instanceof Error && err.message === 'Forbidden'
          ? 'Not authorized to connect Google Calendar.'
          : 'Could not save the connection. Please try again.'
    console.error('[google-calendar/callback] failed:', err)
    return settingsRedirect(origin, { connected: false, error: message })
  }
}
