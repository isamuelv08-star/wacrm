import { createServerClient } from '@supabase/ssr'
import { authCookieKey, getCachedUser, setCachedUser } from '@/lib/auth/proxy-user-cache'
import { NextResponse, type NextRequest } from 'next/server'

// Set on the dedicated agency-panel deployment only (a second EasyPanel
// service on its own subdomain, e.g. agencia.tudominio.com) — NOT on the
// main app. When true, this instance serves nothing but the super-admin
// panel: every other route (the client-facing CRM, signup, etc.) redirects
// away instead of rendering, so a stray link or a bookmark from the main
// app can't land a regular user on a half-working page here. This is a
// presentation/tidiness measure, not the security boundary — /agency and
// /api/agency/* still gate on requireSuperAdmin() (src/lib/auth/agency.ts)
// regardless of which deployment serves the request, so this flag being
// unset (or even misconfigured) never grants access to anything.
const AGENCY_STANDALONE = process.env.AGENCY_STANDALONE_MODE === 'true'

// Exact paths and prefixes this instance is willing to serve. '/login' is
// included because the super admin still authenticates through the normal
// Supabase email/password flow — there's no separate credential system for
// this panel, just a separate URL to reach it from and a stricter route
// allow-list once you're on it.
const AGENCY_STANDALONE_EXACT_PATHS = new Set([
  '/login',
  '/agency',
  '/forgot-password',
  '/reset-password',
  '/login-mfa',
])
// '/api/auth' (email/password sign-in — see /api/auth/login/route.ts)
// was missing here originally: with only '/login' itself allowed,
// the login FORM rendered fine but its POST to /api/auth/login got
// redirected away by the block below before Supabase auth ever ran —
// no cookie was ever set, so the post-login navigation to /dashboard
// (disallowed here too) bounced straight back to /login with no error
// shown, looking like the login silently did nothing.
const AGENCY_STANDALONE_PATH_PREFIXES = ['/api/agency', '/api/auth', '/api/locale', '/auth/callback']

function isAgencyStandaloneAllowedPath(pathname: string): boolean {
  return (
    AGENCY_STANDALONE_EXACT_PATHS.has(pathname) ||
    AGENCY_STANDALONE_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  )
}

// Renamed from `middleware.ts`/`export function middleware` — Next.js 16
// deprecated the `middleware` file convention in favor of `proxy` (same
// runtime hooks, new name + a new Node.js-by-default runtime; see
// node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md's
// "Migration to Proxy" section). Logic is unchanged from the old file.
export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // getUser() THROWS (rather than returning { user: null, error })
  // when the access token is expired and the refresh token it tries to
  // use turns out invalid/missing — e.g. a stale cookie from before a
  // token rotation, or a Supabase project reset. This proxy runs in
  // the Node.js runtime (not the sandboxed Edge runtime) and on every
  // single request, so an unhandled rejection here doesn't just 500
  // one request — it can crash the whole server process and take the
  // deployment into a restart loop. Treat the failure exactly like "no
  // session" instead. Same guard in getCurrentAccount() (account.ts)
  // and requireSuperAdmin() (agency.ts).
  let user: Awaited<ReturnType<typeof supabase.auth.getUser>>['data']['user'] = null

  // A session validated by Supabase Auth a few seconds ago is not
  // re-validated (a network round trip on every request, and a screen
  // fires several). Only successful validations are remembered, briefly —
  // see lib/auth/proxy-user-cache.ts for exactly what that does and
  // doesn't change.
  const authKey = authCookieKey(request.cookies.getAll())
  if (authKey) user = getCachedUser(authKey)

  if (!user) {
    try {
      const result = await supabase.auth.getUser()
      if (result.error) throw result.error
      user = result.data.user
      if (user && authKey) setCachedUser(authKey, user)
    } catch (err) {
      console.error('[proxy] auth.getUser() failed, treating as signed out:', err)
    }
  }

  // getUser() transparently refreshes an expired access token, which
  // ROTATES the refresh token and writes the new cookies onto
  // `supabaseResponse` via setAll() above. Any response we return in
  // place of `supabaseResponse` (every redirect / JSON branch below)
  // is a fresh object that does NOT carry those Set-Cookie headers, so
  // the rotated token never reaches the browser. The next request then
  // replays the old, now-consumed refresh token, the refresh fails, and
  // the session wedges — the user gets a broken reload after idling and
  // can only recover by manually clearing cookies (issue #288). Copy the
  // refreshed cookies onto whatever response we hand back to fix that.
  const withRefreshedCookies = <T extends NextResponse>(response: T): T => {
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      response.cookies.set(cookie)
    })
    return response
  }

  // MFA step-up gate. getAuthenticatorAssuranceLevel() reads the
  // already-loaded session (decodes the access token's `aal` claim
  // and checks the signed-in user's verified factors) — no extra
  // network round trip. A user with a verified TOTP factor whose
  // session hasn't completed that second factor yet (nextLevel is
  // 'aal2' but currentLevel is still 'aal1') isn't treated as fully
  // signed in for page navigation purposes.
  //
  // This redirect is UX only — it walks the user through entering
  // their code instead of the dashboard rendering and then every API
  // call 401ing. The real enforcement is in getCurrentAccount()
  // (src/lib/auth/account.ts) and requireSuperAdmin()
  // (src/lib/auth/agency.ts), which every route ends up going
  // through regardless of what happens here.
  let needsMfaStepUp = false
  if (user) {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    needsMfaStepUp = !!aal && aal.nextLevel === 'aal2' && aal.currentLevel !== aal.nextLevel
  }

  // Agency-standalone deployment: collapse the entire app down to just
  // '/login' + '/agency' (+ their supporting API routes). Everything else
  // — including '/dashboard', which the login page's post-auth
  // `window.location.href` always targets — redirects to '/agency' once
  // signed in, or to '/login' otherwise. Checked before the normal
  // auth-page / protected-page rules below so those never run on this
  // deployment.
  if (AGENCY_STANDALONE) {
    const pathname = request.nextUrl.pathname
    if (user && needsMfaStepUp && pathname !== '/login-mfa') {
      const url = request.nextUrl.clone()
      url.pathname = '/login-mfa'
      url.search = ''
      return withRefreshedCookies(NextResponse.redirect(url))
    }
    if (!isAgencyStandaloneAllowedPath(pathname)) {
      const url = request.nextUrl.clone()
      url.pathname = user ? '/agency' : '/login'
      url.search = ''
      return withRefreshedCookies(NextResponse.redirect(url))
    }
    if (user && pathname === '/login') {
      const url = request.nextUrl.clone()
      url.pathname = '/agency'
      url.search = ''
      return withRefreshedCookies(NextResponse.redirect(url))
    }
    return supabaseResponse
  }

  // Auth pages - redirect to dashboard if already logged in.
  // Exception: when an invite token is in the query string we
  // send the already-signed-in user to /join/<token> instead so
  // they can accept the invitation in one click. Without this,
  // a forwarded invite link to someone who's already signed in
  // would silently drop them on /dashboard.
  if (user && (
    request.nextUrl.pathname === '/login' ||
    request.nextUrl.pathname === '/signup' ||
    request.nextUrl.pathname === '/forgot-password'
  )) {
    const inviteToken = request.nextUrl.searchParams.get('invite')
    const destination =
      inviteToken &&
      (request.nextUrl.pathname === '/login' ||
        request.nextUrl.pathname === '/signup')
        ? `/join/${encodeURIComponent(inviteToken)}`
        : '/dashboard'

    const url = request.nextUrl.clone()
    if (needsMfaStepUp) {
      url.pathname = '/login-mfa'
      url.search = ''
      url.searchParams.set('next', destination)
      return withRefreshedCookies(NextResponse.redirect(url))
    }
    url.pathname = destination
    url.search = ''
    return withRefreshedCookies(NextResponse.redirect(url))
  }

  // Protected pages - redirect to login if not authenticated
  const protectedPaths = ['/dashboard', '/inbox', '/contacts', '/pipelines', '/broadcasts', '/automations', '/settings', '/calendar', '/flows', '/notifications', '/agents']
  if (!user && protectedPaths.some(path => request.nextUrl.pathname.startsWith(path))) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return withRefreshedCookies(NextResponse.redirect(url))
  }

  // MFA step-up gate for protected pages — see the comment above where
  // needsMfaStepUp is computed. /login-mfa itself must stay reachable.
  if (
    user &&
    needsMfaStepUp &&
    request.nextUrl.pathname !== '/login-mfa' &&
    protectedPaths.some(path => request.nextUrl.pathname.startsWith(path))
  ) {
    const next = request.nextUrl.pathname + request.nextUrl.search
    const url = request.nextUrl.clone()
    url.pathname = '/login-mfa'
    url.search = ''
    url.searchParams.set('next', next)
    return withRefreshedCookies(NextResponse.redirect(url))
  }

  // API routes that need auth (not webhooks)
  if (!user && request.nextUrl.pathname.startsWith('/api/whatsapp/') &&
      !request.nextUrl.pathname.includes('/webhook')) {
    return withRefreshedCookies(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|monitoring|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
