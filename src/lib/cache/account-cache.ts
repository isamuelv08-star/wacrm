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
): () => Promise<T> {
  return unstable_cache(fn, ['account-cache', ...keyParts], { revalidate: ttlSeconds })
}
