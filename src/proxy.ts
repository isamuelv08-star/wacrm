import { createServerClient } from '@supabase/ssr'
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
])
const AGENCY_STANDALONE_PATH_PREFIXES = ['/api/agency', '/api/locale', '/auth/callback']

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
  try {
    const result = await supabase.auth.getUser()
    if (result.error) throw result.error
    user = result.data.user
  } catch (err) {
    console.error('[proxy] auth.getUser() failed, treating as signed out:', err)
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

  // Agency-standalone deployment: collapse the entire app down to just
  // '/login' + '/agency' (+ their supporting API routes). Everything else
  // — including '/dashboard', which the login page's post-auth
  // `window.location.href` always targets — redirects to '/agency' once
  // signed in, or to '/login' otherwise. Checked before the normal
  // auth-page / protected-page rules below so those never run on this
  // deployment.
  if (AGENCY_STANDALONE) {
    const pathname = request.nextUrl.pathname
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
    const url = request.nextUrl.clone()
    const inviteToken = request.nextUrl.searchParams.get('invite')
    if (
      inviteToken &&
      (request.nextUrl.pathname === '/login' ||
        request.nextUrl.pathname === '/signup')
    ) {
      url.pathname = `/join/${encodeURIComponent(inviteToken)}`
      url.search = ''
    } else {
      url.pathname = '/dashboard'
      url.search = ''
    }
    return withRefreshedCookies(NextResponse.redirect(url))
  }

  // Protected pages - redirect to login if not authenticated
  const protectedPaths = ['/dashboard', '/inbox', '/contacts', '/pipelines', '/broadcasts', '/automations', '/settings', '/calendar', '/flows', '/notifications', '/agents']
  if (!user && protectedPaths.some(path => request.nextUrl.pathname.startsWith(path))) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
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
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
