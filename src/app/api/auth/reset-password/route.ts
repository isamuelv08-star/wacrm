import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

const MIN_PASSWORD_LEN = 8
const MAX_PASSWORD_LEN = 200

/**
 * Best-effort client IP. Same helper (and same rationale) as
 * src/app/api/auth/login/route.ts.
 */
function getClientIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  const xri = request.headers.get('x-real-ip')
  if (xri) return xri.trim()
  return 'unknown'
}

/**
 * POST /api/auth/reset-password
 *
 * Proxies `supabase.auth.updateUser({ password })` for the recovery
 * flow, mirroring /api/auth/login. Lower severity than the other auth
 * endpoints — it requires an already-established recovery session
 * (see /reset-password's own comment on how that session gets there),
 * so this isn't a credential-guessing surface by itself — but an
 * unbounded endpoint still lets a hijacked recovery session, or a
 * script racing a victim's own reset link, hammer the update call.
 * Bound per-IP for defense in depth, same as every other auth proxy
 * in this app.
 *
 * Requires the browser's `sb-*` session cookies to already carry the
 * recovery session (either from the PKCE exchange in /auth/callback,
 * or from the client-side `setSession` fallback /reset-password uses
 * for admin-issued implicit-grant links) — a same-origin fetch sends
 * them automatically.
 */
export async function POST(request: Request) {
  const ip = getClientIp(request)
  const ipLimit = checkRateLimit(`reset-password:${ip}`, RATE_LIMITS.passwordUpdate)
  if (!ipLimit.success) return rateLimitResponse(ipLimit)

  const body = await request.json().catch(() => null)
  const password = typeof body?.password === 'string' ? body.password : ''

  if (!password || password.length < MIN_PASSWORD_LEN || password.length > MAX_PASSWORD_LEN) {
    return NextResponse.json({ error: 'Invalid password' }, { status: 400 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'No active recovery session' }, { status: 401 })
  }

  // A user with 2FA must pass it before changing the password — a
  // recovery link (or a stolen aal1 session) alone must not be enough
  // to lock the real owner out.
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  if (aal && aal.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') {
    return NextResponse.json(
      { error: 'Two-factor verification required', code: 'mfa_required' },
      { status: 403 },
    )
  }

  const { error } = await supabase.auth.updateUser({ password })
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  return NextResponse.json({ ok: true })
}
