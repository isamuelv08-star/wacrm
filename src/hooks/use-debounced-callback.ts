import { useCallback, useEffect, useRef } from 'react'

/**
 * A stable debounced wrapper around `fn`, for realtime-subscription
 * handlers that reload a whole page section on every `postgres_changes`
 * event. Without this, a burst of writes (a bulk import, an automation
 * touching many rows) fires one full reload per row per open browser
 * tab — this coalesces the burst into one reload `waitMs` after the
 * last event.
 *
 * `maxWaitMs` (default `waitMs * 4`) guarantees at least one run every
 * `maxWaitMs` even while calls keep arriving faster than `waitMs` —
 * otherwise a sustained burst (each new call resetting the timer)
 * could postpone the reload indefinitely.
 *
 * `fn` is read through a ref so callers don't need to memoize it
 * themselves — only `waitMs`/`maxWaitMs` (expected to be constants)
 * recreate the debounced function. The timers live in refs read
 * inside `useCallback`/`useEffect` bodies rather than during render,
 * since reading a ref's value while computing a rendered value trips
 * the `react-hooks/refs` rule.
 */
export function useDebouncedCallback(fn: () => void, waitMs: number, maxWaitMs: number = waitMs * 4) {
  const fnRef = useRef(fn)
  useEffect(() => {
    fnRef.current = fn
  }, [fn])

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clear = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (maxTimerRef.current) clearTimeout(maxTimerRef.current)
    timerRef.current = null
    maxTimerRef.current = null
  }, [])

  useEffect(() => clear, [clear])

  return useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      clear()
      fnRef.current()
    }, waitMs)
    if (!maxTimerRef.current) {
      maxTimerRef.current = setTimeout(() => {
        clear()
        fnRef.current()
      }, maxWaitMs)
    }
  }, [clear, waitMs, maxWaitMs])
}
