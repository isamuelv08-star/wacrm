/**
 * Read every row of a query, page by page. PostgREST silently caps an
 * unbounded select at 1000 rows (Supabase's default `max_rows`), so any
 * aggregate computed in JS over a plain `.select()` was quietly wrong
 * once a table passed 1000 matching rows — no error, just smaller
 * numbers (or, with an ascending order, the OLDEST 1000 rows only).
 *
 * `build(from, to)` must return the same query each time with
 * `.range(from, to)` applied and a deterministic `.order(...)` —
 * without an order, pages can overlap or skip rows.
 *
 * `maxRows` is a safety valve against runaway reads; hitting it is
 * logged so a too-small cap is visible rather than silent.
 */
export async function fetchAllRows<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  opts: { pageSize?: number; maxRows?: number; label?: string } = {},
): Promise<T[]> {
  const pageSize = opts.pageSize ?? 1000
  const maxRows = opts.maxRows ?? 50_000
  const rows: T[] = []

  for (let from = 0; from < maxRows; from += pageSize) {
    const { data, error } = await build(from, from + pageSize - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    rows.push(...data)
    if (data.length < pageSize) return rows
  }

  if (rows.length >= maxRows) {
    console.warn(`[fetchAllRows] ${opts.label ?? 'query'} hit the ${maxRows}-row cap`)
  }
  return rows
}

interface RangeableQuery {
  range(from: number, to: number): PromiseLike<{ data: unknown; error: unknown }>
}

/**
 * Drop-in paged replacement for awaiting a query directly: returns the
 * same `{ data, error }` shape callers already destructure (errors are
 * thrown, so `error` is always null). `make` must build a fresh query
 * with a deterministic `.order(...)` on every call.
 */
export async function selectAll<T = unknown>(
  make: () => RangeableQuery,
  opts?: { pageSize?: number; maxRows?: number; label?: string },
): Promise<{ data: T[]; error: null }> {
  const data = await fetchAllRows<T>(
    (from, to) => make().range(from, to) as PromiseLike<{ data: T[] | null; error: unknown }>,
    opts,
  )
  return { data, error: null }
}
