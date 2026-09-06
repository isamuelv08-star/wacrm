import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

const MAX_EMAIL_LEN = 254
const MAX_PASSWORD_LEN = 200

/**
 * Best-effort client IP. Same helper (and same rationale) as
 * src/app/api/invitations/[token]/peek/route.ts — the `x-forwarded-for`
 * header is what every reverse proxy sets when forwarding a request;
 * we take the leftmost entry, the original client. Falls back to a
 * constant when there's no proxy in front (e.g. localhost in dev), so
 * the rate-limit key still exists.
 */
function getClientIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  const xri = request.headers.get('x-real-ip')
  if (xri) return xri.trim()
  return 'unknown'
}

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
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  return NextResponse.json({ ok: true })
}
