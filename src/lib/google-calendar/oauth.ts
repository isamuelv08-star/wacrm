// ============================================================
// Raw Google OAuth 2.0 + userinfo calls for the Calendar connect
// flow. No `googleapis` SDK — same "plain fetch against the
// provider's REST API" posture the rest of the codebase already uses
// for external integrations (see `zernioFetch` in
// src/app/api/zernio/connect/[platform]/route.ts).
// ============================================================

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo'

/** Scoped to just events (not full calendar management) plus enough
 *  identity to show which Google account is connected. */
const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'openid',
  'email',
].join(' ')

export class GoogleOAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GoogleOAuthError'
  }
}

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new GoogleOAuthError(`${name} is not configured on this server.`)
  return value
}

/** Where Google should redirect back to once the consent screen
 *  finishes — shared by the connect and callback routes so they
 *  always agree on the exact same URI (Google rejects a token
 *  exchange whose redirect_uri doesn't match the one used to start
 *  the flow, byte for byte). */
export function googleCalendarRedirectUri(origin: string): string {
  return process.env.GOOGLE_CALENDAR_REDIRECT_URL || `${origin}/api/integrations/google-calendar/callback`
}

export function buildAuthUrl(state: string, redirectUri: string): string {
  const clientId = requireEnv('GOOGLE_CLIENT_ID')
  const url = new URL(AUTH_URL)
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', SCOPES)
  url.searchParams.set('state', state)
  // access_type=offline is what gets us a refresh_token at all;
  // prompt=consent forces Google to hand one back even if this Google
  // account already authorized this app before (Google otherwise
  // omits it on a repeat consent, which would silently leave us
  // unable to refresh past the first hour).
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent')
  return url.toString()
}

export interface GoogleTokens {
  accessToken: string
  refreshToken: string | null
  expiresInSeconds: number
  scope: string
}

async function tokenRequest(body: Record<string, string>): Promise<GoogleTokens> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    console.error('[google-calendar/oauth] token request failed:', data)
    throw new GoogleOAuthError(
      typeof data?.error_description === 'string' ? data.error_description : 'Google rejected the request.',
    )
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresInSeconds: typeof data.expires_in === 'number' ? data.expires_in : 3600,
    scope: typeof data.scope === 'string' ? data.scope : SCOPES,
  }
}

export async function exchangeCodeForTokens(code: string, redirectUri: string): Promise<GoogleTokens> {
  return tokenRequest({
    code,
    client_id: requireEnv('GOOGLE_CLIENT_ID'),
    client_secret: requireEnv('GOOGLE_CLIENT_SECRET'),
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  })
}

/** Refreshes an access token. Google never returns a new
 *  `refresh_token` on this grant — the caller must keep reusing the
 *  one it already has. */
export async function refreshAccessToken(refreshToken: string): Promise<GoogleTokens> {
  return tokenRequest({
    refresh_token: refreshToken,
    client_id: requireEnv('GOOGLE_CLIENT_ID'),
    client_secret: requireEnv('GOOGLE_CLIENT_SECRET'),
    grant_type: 'refresh_token',
  })
}

/** Best-effort revoke — callers should disconnect locally regardless
 *  of whether this succeeds (mirrors the Zernio disconnect route's
 *  posture: the user's intent to disconnect always takes effect
 *  here, even if the upstream revoke call fails). */
export async function revokeToken(token: string): Promise<boolean> {
  try {
    const res = await fetch(`${REVOKE_URL}?token=${encodeURIComponent(token)}`, { method: 'POST' })
    return res.ok
  } catch (err) {
    console.error('[google-calendar/oauth] revoke failed:', err)
    return false
  }
}

export async function fetchGoogleEmail(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) return null
    const data = await res.json()
    return typeof data?.email === 'string' ? data.email : null
  } catch (err) {
    console.error('[google-calendar/oauth] userinfo fetch failed:', err)
    return null
  }
}
