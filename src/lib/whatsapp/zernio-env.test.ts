import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __testing, zernioApiKey, zernioWebhookSecret } from './zernio-env'

const KEY = 'ZERNIO_API_KEY'
const SECRET = 'ZERNIO_WEBHOOK_SECRET'

describe('zernio env', () => {
  const saved = { key: process.env[KEY], secret: process.env[SECRET] }

  beforeEach(() => {
    delete process.env[KEY]
    delete process.env[SECRET]
    __testing.reset()
  })
  afterEach(() => {
    if (saved.key === undefined) delete process.env[KEY]
    else process.env[KEY] = saved.key
    if (saved.secret === undefined) delete process.env[SECRET]
    else process.env[SECRET] = saved.secret
    vi.restoreAllMocks()
  })

  it.each([
    ['plain', 'sk_abc123', 'sk_abc123'],
    ['trailing newline', 'sk_abc123\n', 'sk_abc123'],
    ['CRLF and spaces', '  sk_abc123 \r\n', 'sk_abc123'],
    ['double quotes', '"sk_abc123"', 'sk_abc123'],
    ['single quotes', "'sk_abc123'", 'sk_abc123'],
    ['quotes with inner padding', '" sk_abc123 "', 'sk_abc123'],
  ])('cleans %s', (_label, raw, expected) => {
    expect(__testing.clean(raw)).toBe(expected)
  })

  it('treats unset and blank as undefined', () => {
    expect(__testing.clean(undefined)).toBeUndefined()
    expect(__testing.clean('   ')).toBeUndefined()
    expect(__testing.clean('""')).toBeUndefined()
  })

  it('leaves a lone quote character alone', () => {
    expect(__testing.clean('"')).toBe('"')
  })

  it('reads the key and the secret', () => {
    process.env[KEY] = ' sk_key\n'
    process.env[SECRET] = '"whsec_secret"'
    expect(zernioApiKey()).toBe('sk_key')
    expect(zernioWebhookSecret()).toBe('whsec_secret')
  })

  it('warns exactly once when the key and the secret are the same value', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    process.env[KEY] = 'same-value'
    process.env[SECRET] = ' same-value '
    expect(zernioApiKey()).toBe('same-value')
    zernioApiKey()
    expect(err).toHaveBeenCalledTimes(1)
    expect(String(err.mock.calls[0][0])).toContain('SAME value')
  })

  it('does not warn when they differ', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    process.env[KEY] = 'key'
    process.env[SECRET] = 'secret'
    zernioApiKey()
    expect(err).not.toHaveBeenCalled()
  })
})
