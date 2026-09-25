/**
 * Return `next` only when it is a same-origin path, otherwise
 * `fallback`. Used for every `?next=` redirect target, which arrives
 * as an untrusted query string.
 *
 * A plain `startsWith('/') && !startsWith('//')` check is not enough:
 * browsers normalize `\` to `/`, so `/\evil.com` becomes
 * `//evil.com` (protocol-relative) — an open redirect. Resolve against
 * a dummy origin and require the origin to be unchanged.
 */
export function safeRedirectPath(next: string | null | undefined, fallback = '/dashboard'): string {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return fallback
  // Backslashes and control characters have no business in our paths.
  if (/[\\\u0000-\u001f\u007f]/.test(next)) return fallback
  try {
    const base = 'https://same-origin.invalid'
    const url = new URL(next, base)
    if (url.origin !== base) return fallback
    return url.pathname + url.search + url.hash
  } catch {
    return fallback
  }
}
