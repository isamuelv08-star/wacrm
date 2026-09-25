import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { sameOriginUrl } from '@/lib/http/safe-redirect'
import { getPublicOrigin } from '@/lib/http/request-origin'
import { getClientIp } from '@/lib/http/client-ip'

const MAX_EMAIL_LEN = 254

/**
 * POST /api/auth/forgot-password
 *
 * Proxies `supabase.auth.resetPasswordForEmail`, mirroring why
 * /api/auth/login exists: the page used to call that Supabase method
 * directly from the browser, straight to Supabase's public Auth URL,
 * where this app's own in-process rate limiter never saw the request.
 * That left nothing here to stop a script from mass-triggering reset
 * emails at arbitrary addresses (an email-bombing / enumeration
 * nuisance, even though it can't leak whether the address exists —
 * Supabase always returns success). Two independent budgets: per-IP
 * (bounds one script) and per-email (bounds repeated targeting of one
 * inbox from many IPs).
 */
export async function POST(request: Request) {
  const ip = getClientIp(request)
  const ipLimit = checkRateLimit(`forgot-password:${ip}`, RATE_LIMITS.passwordResetRequest)
  if (!ipLimit.success) return rateLimitResponse(ipLimit)

  const body = await request.json().catch(() => null)
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  const redirectTo = sameOriginUrl(body?.redirectTo, getPublicOrigin(request))

  if (!email || email.length > MAX_EMAIL_LEN) {
    return NextResponse.json({ error: 'Invalid email' }, { status: 400 })
  }

  const emailLimit = checkRateLimit(
    `forgot-password-email:${email}`,
    RATE_LIMITS.passwordResetRequestEmail,
  )
  if (!emailLimit.success) return rateLimitResponse(emailLimit)

  const supabase = await createClient()
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    ...(redirectTo ? { redirectTo } : {}),
  })

  // Supabase itself returns success even for an unknown email (no
  // enumeration via this response) — surface a generic failure only
  // for genuine errors (malformed input, provider outage), never
  // "email not found".
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  return NextResponse.json({ ok: true })
}
