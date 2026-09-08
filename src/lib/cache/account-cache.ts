import { unstable_cache } from 'next/cache'

/**
 * Documented TTL menu for account-scoped server caches, so every
 * cached route picks from one deliberate list instead of inventing its
 * own number. Add to this as new cached routes need a different
 * staleness trade-off — don't hardcode a bare number at the call site.
 */
export const CACHE_TTL = {
  /** Aggregated dashboard/report numbers (scans/aggregates across
   *  deals, pipeline stages, etc.) — a few minutes of staleness is an
   *  acceptable trade for not recomputing on every page view, shared
   *  across every viewer of the same account. */
  dashboardSummary: 180,
} as const

/**
 * Compute-once-per-account-and-key wrapper around `unstable_cache`.
 * `keyParts` must start with the caller's `accountId` so accounts
 * never share a cache entry with each other; add any params the
 * result depends on (period range, filters, ...) after it.
 *
 * `tags`, when given, are also passed straight to `unstable_cache` —
 * calling `revalidateTag(tag)` (from a Route Handler) evicts every
 * entry sharing that tag immediately, regardless of its exact key.
 * That's what lets a real user action (e.g. dragging a deal to a new
 * stage) force a cache miss on demand instead of waiting out the TTL
 * — see /api/dashboard/ceo-summary/revalidate.
 *
 * IMPORTANT — Next's default cache handler backing `unstable_cache` is
 * in-memory/filesystem PER PROCESS. On a single Docker container
 * that's exactly what you want: one shared cache for every viewer of
 * an account. If this app ever runs more than one instance at once
 * (horizontal scale, multi-region), each instance keeps its own
 * independent cache — hit rate drops, and instances can briefly
 * disagree within a TTL window. At that point, swap Next's
 * `cacheHandler` config for a Redis-backed implementation; call sites
 * using this helper don't change. Same single-instance caveat, same
 * fix, as the in-memory limiter in `src/lib/rate-limit.ts`.
 */
export function cachedForAccount<T>(
  keyParts: [accountId: string, ...rest: string[]],
  ttlSeconds: number,
  fn: () => Promise<T>,
  tags?: string[],
): () => Promise<T> {
  return unstable_cache(fn, ['account-cache', ...keyParts], { revalidate: ttlSeconds, tags })
}

/** Shared tag for every cache entry that backs the CEO/sales dashboard
 *  summary for one account — see the ceo-summary route (writer) and
 *  its sibling revalidate route (the only caller of `revalidateTag`
 *  with this tag). */
export function dashboardSummaryCacheTag(accountId: string): string {
  return `dashboard-summary:${accountId}`
}
