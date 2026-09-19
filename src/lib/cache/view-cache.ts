/**
 * In-memory "last known data" cache for the dashboard's list screens
 * (stale-while-revalidate, client only).
 *
 * Every screen is a client component that fetches on mount, so coming
 * back to Inbox / Contacts / Pipelines used to mean: unmount, spinner,
 * refetch, content pops in. That blank-then-content cycle is what reads
 * as flicker. With this cache a screen renders the last snapshot on the
 * very first frame and refreshes it in the background — the fresh data
 * simply replaces what is already on screen.
 *
 * It is a snapshot for display only. The screen still refetches on
 * every mount, so nothing is ever served without being revalidated, and
 * a cache miss behaves exactly as before.
 *
 * Lives in module scope: survives client-side navigation, is dropped on
 * a full reload, and is cleared on sign-out (see use-auth.tsx) so one
 * user's data can never be shown to the next person in the same tab.
 * Keys must include the user id for the same reason.
 */

const MAX_ENTRIES = 40

const store = new Map<string, unknown>()

/** The cached snapshot for `key`, or undefined on a miss. */
export function readViewCache<T>(key: string | null | undefined): T | undefined {
  if (!key) return undefined
  if (!store.has(key)) return undefined
  // Refresh recency (Map keeps insertion order): re-insert on read.
  const value = store.get(key)
  store.delete(key)
  store.set(key, value)
  return value as T
}

export function writeViewCache<T>(key: string | null | undefined, value: T): void {
  if (!key) return
  store.delete(key)
  store.set(key, value)
  // Evict the least-recently used entries beyond the cap.
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value
    if (oldest === undefined) break
    store.delete(oldest)
  }
}

/** Drop everything (sign-out) or every key with the given prefix. */
export function clearViewCache(prefix?: string): void {
  if (!prefix) {
    store.clear()
    return
  }
  for (const key of [...store.keys()]) {
    if (key.startsWith(prefix)) store.delete(key)
  }
}

/** Test/inspection helper. */
export function viewCacheSize(): number {
  return store.size
}
