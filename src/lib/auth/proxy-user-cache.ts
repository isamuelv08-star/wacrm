import { createHash } from 'node:crypto'
import type { User } from '@supabase/supabase-js'

/**
 * Short-lived in-memory memo of "this session cookie was just validated
 * by Supabase Auth", for the request proxy (src/proxy.ts).
 *
 * Why: the proxy runs on EVERY page load, client-side navigation and API
 * call, and each run awaited `supabase.auth.getUser()` — a full network
 * round trip from the server to Supabase Auth. A single screen fires
 * several requests, so that wait stacked up on every click. Re-validating
 * the same session a few seconds later adds nothing.
 *
 * What it changes, precisely:
 *  - Only a SUCCESSFUL validation is remembered, never "signed out".
 *  - For at most `ttlMs` (default 30 s). A session revoked in that window
 *    passes the proxy's page-level gate for up to that long; it does not
 *    widen data access — every route still authorises the caller itself
 *    (getCurrentAccount / requireRole) and Postgres RLS checks the JWT.
 *  - The key is a SHA-256 of the auth cookies, so raw tokens are never
 *    held, sign-out (cookies gone) and sign-in (new cookies) miss the
 *    cache automatically, and a rotated token is validated afresh.
 *
 * Disable with PROXY_AUTH_CACHE_MS=0.
 */

const DEFAULT_TTL_MS = 30_000
const MAX_ENTRIES = 500

const cache = new Map<string, { user: User; expiresAt: number }>()

function ttlMs(): number {
  const raw = process.env.PROXY_AUTH_CACHE_MS
  if (raw === undefined || raw === '') return DEFAULT_TTL_MS
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_TTL_MS
}

/** Cache key for a request's Supabase auth cookies, or null when it has
 *  none (nothing to remember). */
export function authCookieKey(cookies: { name: string; value: string }[]): string | null {
  const auth = cookies
    .filter((c) => c.name.startsWith('sb-'))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  if (auth.length === 0) return null
  return createHash('sha256')
    .update(auth.map((c) => `${c.name}=${c.value}`).join(';'))
    .digest('hex')
}

export function getCachedUser(key: string, now: number = Date.now()): User | null {
  const hit = cache.get(key)
  if (!hit) return null
  if (hit.expiresAt <= now) {
    cache.delete(key)
    return null
  }
  return hit.user
}

export function setCachedUser(key: string, user: User, now: number = Date.now()): void {
  const ttl = ttlMs()
  if (ttl === 0) return
  cache.set(key, { user, expiresAt: now + ttl })
  // Drop expired entries first, then the oldest, to stay bounded.
  if (cache.size > MAX_ENTRIES) {
    for (const [k, v] of cache) if (v.expiresAt <= now) cache.delete(k)
    while (cache.size > MAX_ENTRIES) {
      const oldest = cache.keys().next().value
      if (oldest === undefined) break
      cache.delete(oldest)
    }
  }
}

export function clearProxyUserCache(): void {
  cache.clear()
}
