// ============================================================
// GET /auth/callback — Supabase Auth PKCE return leg.
//
// For a Supabase email flow that issues a PKCE `?code=` (exchanged
// here via exchangeCodeForSession — that call is what actually sets
// the sb-* session cookies), this is where the browser should land
// after clicking the email link. Only once the exchange succeeds do
// we forward the browser to `next` (defaults to /dashboard).
//
// NOT currently used by password recovery: this Supabase project
// issues recovery links as an implicit grant (`#access_token=...` in
// the URL fragment) instead of PKCE, regardless of what the
// requesting client asks for — confirmed by generating a recovery
// link with an explicit code_challenge and still getting a hash-based
// redirect back. A fragment never reaches the server, so a route like
// this one — which only ever looks at the query string — can't do
// anything with it; forgot-password/page.tsx and the agency "send
// this member a reset link" flow both point straight at
// /reset-password instead, which reads the hash client-side (see its
// useEffect). Left in place for any future flow that genuinely gets a
// PKCE code (e.g. an OAuth/social login redirect).
// ============================================================

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getPublicOrigin } from '@/lib/http/request-origin'

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/dashboard'
  const origin = getPublicOrigin(request)

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(new URL(next, origin))
    }
    console.error('[auth/callback] exchangeCodeForSession failed:', error.message)
  }

  const url = new URL('/login', origin)
  url.searchParams.set('auth_error', '1')
  return NextResponse.redirect(url)
}
