import { describe, it, expect, afterEach } from 'vitest'
import { getClientIp } from './client-ip'

const req = (headers: Record<string, string>) => new Request('https://x/', { headers })

afterEach(() => {
  delete process.env.TRUSTED_PROXY_HOPS
})

describe('getClientIp', () => {
  it('ignores client-supplied entries and takes the one our proxy appended', () => {
    // Caller spoofs "1.1.1.1"; the proxy appends the real peer 9.9.9.9.
    expect(getClientIp(req({ 'x-forwarded-for': '1.1.1.1, 9.9.9.9' }))).toBe('9.9.9.9')
  })

  it('honours TRUSTED_PROXY_HOPS for a chain of proxies', () => {
    process.env.TRUSTED_PROXY_HOPS = '2'
    expect(getClientIp(req({ 'x-forwarded-for': '1.1.1.1, 9.9.9.9, 10.0.0.2' }))).toBe('9.9.9.9')
  })

  it('falls back to X-Real-IP, then "unknown"', () => {
    expect(getClientIp(req({ 'x-real-ip': '8.8.8.8' }))).toBe('8.8.8.8')
    expect(getClientIp(req({}))).toBe('unknown')
  })
})
