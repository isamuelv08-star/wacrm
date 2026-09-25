import { describe, it, expect } from 'vitest'
import { safeRedirectPath } from './safe-redirect'

describe('safeRedirectPath', () => {
  it('keeps same-origin paths, including query and hash', () => {
    expect(safeRedirectPath('/inbox')).toBe('/inbox')
    expect(safeRedirectPath('/contacts?id=1#notes')).toBe('/contacts?id=1#notes')
  })

  it('falls back for missing or relative values', () => {
    expect(safeRedirectPath(null)).toBe('/dashboard')
    expect(safeRedirectPath('')).toBe('/dashboard')
    expect(safeRedirectPath('inbox')).toBe('/dashboard')
  })

  it('rejects protocol-relative and absolute URLs', () => {
    expect(safeRedirectPath('//evil.com')).toBe('/dashboard')
    expect(safeRedirectPath('https://evil.com')).toBe('/dashboard')
  })

  it('rejects backslash tricks browsers normalize to //', () => {
    expect(safeRedirectPath('/\\evil.com')).toBe('/dashboard')
    expect(safeRedirectPath('/\\/evil.com')).toBe('/dashboard')
  })

  it('rejects control characters', () => {
    expect(safeRedirectPath('/\t/evil.com')).toBe('/dashboard')
  })

  it('uses the given fallback', () => {
    expect(safeRedirectPath('//x', '/login')).toBe('/login')
  })
})
