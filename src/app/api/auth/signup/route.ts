import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { sameOriginUrl } from '@/lib/http/safe-redirect'
import { getPublicOrigin } from '@/lib/http/request-origin'
import { getClientIp } from '@/lib/http/client-ip'

const MAX_EMAIL_LEN = 254
const MAX_PASSWORD_LEN = 200
const MAX_NAME_LEN = 200
const MIN_PASSWORD_LEN = 8

/**
 * POST /api/auth/signup
 *
 * Proxies `supabase.auth.signUp`, mirroring /api/auth/login: the page
 * used to call that Supabase method directly from the browser, which
 * bypassed this app's own rate limiter entirely. New accounts still
 * need manual admin approval (migration 088), so an unbounded signup
 * endpoint isn't an account-takeover risk, but it's still an open
 * door for mass account/spam creation and inbox-bombing (every call
 * sends a verification email) — bound it per-IP the same way.
 *
 * Runs inside a real Route Handler, so the SSR server client's
 * `cookies().set()` calls attach any session cookie Supabase issues
 * to the response we return.
 */
export async function POST(request: Request) {
  const ip = getClientIp(request)
  const ipLimit = checkRateLimit(`signup:${ip}`, RATE_LIMITS.signup)
  if (!ipLimit.success) return rateLimitResponse(ipLimit)

  const body = await request.json().catch(() => null)
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = typeof body?.password === 'string' ? body.password : ''
  const fullName = typeof body?.fullName === 'string' ? body.fullName.trim() : ''
  const emailRedirectTo = sameOriginUrl(body?.emailRedirectTo, getPublicOrigin(request))

  if (
    !email ||
    email.length > MAX_EMAIL_LEN ||
    !password ||
    password.length < MIN_PASSWORD_LEN ||
    password.length > MAX_PASSWORD_LEN ||
    fullName.length > MAX_NAME_LEN
  ) {
    return NextResponse.json({ error: 'Invalid signup data' }, { status: 400 })
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
      ...(emailRedirectTo ? { emailRedirectTo } : {}),
    },
  })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  return NextResponse.json({ ok: true })
}
