import { beforeEach, describe, expect, it } from 'vitest'
import { clearViewCache, readViewCache, viewCacheSize, writeViewCache } from './view-cache'

describe('view cache', () => {
  beforeEach(() => clearViewCache())

  it('returns undefined on a miss and for an empty key', () => {
    expect(readViewCache('nope')).toBeUndefined()
    expect(readViewCache(null)).toBeUndefined()
    expect(readViewCache(undefined)).toBeUndefined()
  })

  it('round-trips a snapshot', () => {
    writeViewCache('inbox:u1', [{ id: 'c1' }])
    expect(readViewCache<{ id: string }[]>('inbox:u1')).toEqual([{ id: 'c1' }])
  })

  it('ignores writes with an empty key', () => {
    writeViewCache(null, 1)
    writeViewCache('', 1)
    expect(viewCacheSize()).toBe(0)
  })

  it('overwrites an existing key', () => {
    writeViewCache('k', 1)
    writeViewCache('k', 2)
    expect(readViewCache('k')).toBe(2)
    expect(viewCacheSize()).toBe(1)
  })

  it('keeps users apart because keys carry the user id', () => {
    writeViewCache('contacts:user-a', ['a'])
    expect(readViewCache('contacts:user-b')).toBeUndefined()
  })

  it('clears everything, e.g. on sign-out', () => {
    writeViewCache('a', 1)
    writeViewCache('b', 2)
    clearViewCache()
    expect(viewCacheSize()).toBe(0)
    expect(readViewCache('a')).toBeUndefined()
  })

  it('clears by prefix only', () => {
    writeViewCache('inbox:u1', 1)
    writeViewCache('contacts:u1', 2)
    clearViewCache('inbox:')
    expect(readViewCache('inbox:u1')).toBeUndefined()
    expect(readViewCache('contacts:u1')).toBe(2)
  })

  it('evicts the least recently used entry past the cap', () => {
    for (let i = 0; i < 40; i++) writeViewCache(`k${i}`, i)
    readViewCache('k0') // k0 is now the most recently used
    writeViewCache('overflow', 'x') // 41st entry → evict the oldest, k1
    expect(readViewCache('k1')).toBeUndefined()
    expect(readViewCache('k0')).toBe(0)
    expect(readViewCache('overflow')).toBe('x')
    expect(viewCacheSize()).toBe(40)
  })
})
