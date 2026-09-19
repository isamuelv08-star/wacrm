import type { User } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  authCookieKey,
  clearProxyUserCache,
  getCachedUser,
  setCachedUser,
} from './proxy-user-cache'

const user = { id: 'u1' } as User

describe('authCookieKey', () => {
  it('is null when there are no Supabase auth cookies', () => {
    expect(authCookieKey([])).toBeNull()
    expect(authCookieKey([{ name: 'NEXT_LOCALE', value: 'es' }])).toBeNull()
  })

  it('does not contain the raw token', () => {
    const key = authCookieKey([{ name: 'sb-abc-auth-token', value: 'super-secret-jwt' }])!
    expect(key).toMatch(/^[0-9a-f]{64}$/)
    expect(key).not.toContain('super-secret-jwt')
  })

  it('is stable regardless of cookie order, and ignores non-auth cookies', () => {
    const a = authCookieKey([
      { name: 'sb-x-auth-token.1', value: '2' },
      { name: 'sb-x-auth-token.0', value: '1' },
      { name: 'theme', value: 'dark' },
    ])
    const b = authCookieKey([
      { name: 'sb-x-auth-token.0', value: '1' },
      { name: 'sb-x-auth-token.1', value: '2' },
    ])
    expect(a).toBe(b)
  })

  it('changes when a token rotates', () => {
    const before = authCookieKey([{ name: 'sb-x-auth-token', value: 'old' }])
    const after = authCookieKey([{ name: 'sb-x-auth-token', value: 'new' }])
    expect(before).not.toBe(after)
  })
})

describe('user cache', () => {
  const saved = process.env.PROXY_AUTH_CACHE_MS
  beforeEach(() => {
    delete process.env.PROXY_AUTH_CACHE_MS
    clearProxyUserCache()
  })
  afterEach(() => {
    if (saved === undefined) delete process.env.PROXY_AUTH_CACHE_MS
    else process.env.PROXY_AUTH_CACHE_MS = saved
  })

  it('misses on an unknown key', () => {
    expect(getCachedUser('nope', 0)).toBeNull()
  })

  it('returns the user within the TTL and forgets it after', () => {
    setCachedUser('k', user, 1_000)
    expect(getCachedUser('k', 1_000 + 29_999)).toBe(user)
    expect(getCachedUser('k', 1_000 + 30_000)).toBeNull()
    // Expired entries are dropped, not just hidden.
    expect(getCachedUser('k', 1_000)).toBeNull()
  })

  it('can be disabled with PROXY_AUTH_CACHE_MS=0', () => {
    process.env.PROXY_AUTH_CACHE_MS = '0'
    setCachedUser('k', user, 0)
    expect(getCachedUser('k', 1)).toBeNull()
  })

  it('honours a custom TTL and ignores garbage values', () => {
    process.env.PROXY_AUTH_CACHE_MS = '5000'
    setCachedUser('a', user, 0)
    expect(getCachedUser('a', 4_999)).toBe(user)
    expect(getCachedUser('a', 5_000)).toBeNull()

    process.env.PROXY_AUTH_CACHE_MS = 'abc'
    setCachedUser('b', user, 0)
    expect(getCachedUser('b', 29_999)).toBe(user) // fell back to 30 s
  })

  it('stays bounded', () => {
    for (let i = 0; i < 700; i++) setCachedUser(`k${i}`, user, 0)
    let alive = 0
    for (let i = 0; i < 700; i++) if (getCachedUser(`k${i}`, 1)) alive++
    expect(alive).toBeLessThanOrEqual(500)
  })
})
