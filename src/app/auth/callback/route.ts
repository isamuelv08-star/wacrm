// ============================================================
// GET /auth/callback — Supabase Auth PKCE return leg.
//
// Every Supabase email flow that needs the browser to come back to
// this app (password recovery, email-change confirmation, magic
// links) is configured to redirect here first: it hands us a
// short-lived `code` in the query string, which we exchange for a
// real session via exchangeCodeForSession — that call is what
// actually sets the sb-* session cookies. Only once that's done do we
// forward the browser to `next` (defaults to /dashboard).
//
// This route didn't exist before, even though forgot-password/page.tsx
// already pointed here (`redirectTo: .../auth/callback?next=/reset-password`)
// — every password-reset attempt 404'd at this step, one hop before
// the user ever saw /reset-password.
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
