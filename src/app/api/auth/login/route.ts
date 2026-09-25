import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/http/client-ip'

const MAX_EMAIL_LEN = 254
const MAX_PASSWORD_LEN = 200

/**
 * POST /api/auth/login
 *
 * Email/password sign-in, proxied through our own server instead of
 * the login page calling `supabase.auth.signInWithPassword` straight
 * from the browser — that call went directly to Supabase's public
 * Auth URL, which our own in-process rate limiter never saw a request
 * for, leaving nothing here to stop a bot from retrying it as fast as
 * it liked. Two independent budgets: per-IP (bounds one bot/script)
 * and per-email (bounds a credential-stuffing run spread across many
 * IPs at one victim account).
 *
 * Runs inside a real Route Handler, so the SSR server client's
 * `cookies().set()` calls (triggered by a successful
 * `signInWithPassword`) actually attach the sb-* session cookies to
 * the response we return — the client just needs to redirect after.
 *
 * This only protects sign-ins that go through our own app. Anyone
 * calling Supabase's Auth API directly with the public anon key
 * bypasses this route entirely — that traffic is bounded by Supabase's
 * own GoTrue rate limits / Attack Protection (CAPTCHA) settings in the
 * project dashboard, which this codebase can't configure.
 */
export async function POST(request: Request) {
  const ip = getClientIp(request)
  const ipLimit = checkRateLimit(`login:${ip}`, RATE_LIMITS.login)
  if (!ipLimit.success) return rateLimitResponse(ipLimit)

  const body = await request.json().catch(() => null)
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = typeof body?.password === 'string' ? body.password : ''

  if (!email || email.length > MAX_EMAIL_LEN || !password || password.length > MAX_PASSWORD_LEN) {
    return NextResponse.json({ error: 'Invalid login credentials' }, { status: 400 })
  }

  const emailLimit = checkRateLimit(`login-email:${email}`, RATE_LIMITS.loginEmail)
  if (!emailLimit.success) return rateLimitResponse(emailLimit)

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) {
    // Generic on purpose: Supabase's raw message ("Email not confirmed"
    // vs "Invalid login credentials") tells a prober which emails exist.
    // An unconfirmed address gets its own code so the UI can still say
    // "check your inbox" without echoing the upstream text.
    const unconfirmed = /not confirmed/i.test(error.message)
    return NextResponse.json(
      { error: 'Invalid login credentials', ...(unconfirmed ? { code: 'email_not_confirmed' } : {}) },
      { status: 400 },
    )
  }

  return NextResponse.json({ ok: true })
}
