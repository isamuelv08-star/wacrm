/**
 * Run `fn` over `items` with at most `limit` in flight — for cron jobs
 * that do per-account work: sequential is too slow once there are
 * hundreds of accounts, unbounded Promise.all floods the database.
 * `fn` should handle its own errors; a throw is logged and skipped.
 */
export async function forEachWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++]
      try {
        await fn(item)
      } catch (err) {
        console.error('[concurrency] task failed:', err)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker))
}
