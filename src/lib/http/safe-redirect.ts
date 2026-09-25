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

/**
 * A client-supplied absolute redirect URL (Supabase `emailRedirectTo` /
 * `redirectTo`), accepted only when it points at our own origin.
 * Returns undefined otherwise, so the caller falls back to Supabase's
 * configured Site URL. Supabase's redirect allowlist is the other line
 * of defense; this keeps a lax allowlist from turning signup and
 * password-reset emails into links to someone else's site.
 */
export function sameOriginUrl(raw: unknown, origin: string): string | undefined {
  if (typeof raw !== 'string' || !raw) return undefined
  try {
    const url = new URL(raw, origin)
    return url.origin === new URL(origin).origin ? url.toString() : undefined
  } catch {
    return undefined
  }
}
