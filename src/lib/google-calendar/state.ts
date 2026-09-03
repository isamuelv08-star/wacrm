import crypto from 'crypto'

// ============================================================
// Signed `state` param for the Google Calendar OAuth connect flow.
//
// Unlike the Zernio connect flow (src/app/api/zernio/connect/
// [platform]/route.ts), there is no broker in between that mints its
// own durable id to look the callback up by — this is a direct
// Google OAuth round trip, so `state` is the only thing carried
// through it. It has to be tamper-proof: an attacker who could craft
// their own `state` and get an admin's browser to hit our callback
// with it (classic OAuth CSRF) could otherwise attach their own
// Google account's calendar to someone else's CRM account. Signing
// with the same server-only ENCRYPTION_KEY used for token encryption
// closes that off — the callback also re-checks the caller's live
// session account id against the one embedded here (see
// /api/integrations/google-calendar/callback).
// ============================================================

const STATE_TTL_MS = 10 * 60 * 1000

interface StatePayload {
  accountId: string
  nonce: string
  ts: number
}

function hmac(payload: string): string {
  return crypto
    .createHmac('sha256', Buffer.from(process.env.ENCRYPTION_KEY!, 'hex'))
    .update(payload)
    .digest('hex')
}

export function signState(accountId: string): string {
  const payload: StatePayload = {
    accountId,
    nonce: crypto.randomBytes(16).toString('hex'),
    ts: Date.now(),
  }
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${encoded}.${hmac(encoded)}`
}

/**
 * Verify a `state` string came from `signState` unmodified and hasn't
 * expired. Returns the embedded `accountId` on success, `null` on any
 * failure (bad signature, expired, malformed) — callers treat every
 * failure identically (reject the callback), so there's no need to
 * distinguish the reason beyond what's logged here.
 */
export function verifyState(state: string): string | null {
  const parts = state.split('.')
  if (parts.length !== 2) return null
  const [encoded, signature] = parts

  const expected = hmac(encoded)
  const sigBuf = Buffer.from(signature, 'hex')
  const expectedBuf = Buffer.from(expected, 'hex')
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    console.warn('[google-calendar/state] signature mismatch')
    return null
  }

  let payload: StatePayload
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
  } catch {
    console.warn('[google-calendar/state] malformed payload')
    return null
  }

  if (typeof payload.accountId !== 'string' || typeof payload.ts !== 'number') return null
  if (Date.now() - payload.ts > STATE_TTL_MS) {
    console.warn('[google-calendar/state] expired')
    return null
  }

  return payload.accountId
}
