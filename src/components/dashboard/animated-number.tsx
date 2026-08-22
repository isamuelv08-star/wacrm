"use client"

import { useEffect, useRef, useState } from 'react'

interface AnimatedNumberProps {
  /** Raw numeric value — the component owns formatting via `formatter`
   *  so it can re-format the in-between values on every animation
   *  frame (a pre-formatted string couldn't be interpolated). */
  value: number
  formatter: (n: number) => string
  durationMs?: number
}

/**
 * Counts up (or down) from whatever it last displayed to `value`,
 * re-running the real formatter every frame rather than animating a
 * string — that's what keeps currency/thousands-separator formatting
 * correct throughout the animation instead of just at the end.
 *
 * Mounts at 0 and animates up to the first `value` it receives, so a
 * card's number visibly arrives the moment its data resolves (that's
 * the "dashboard feels alive on load" cue) — then animates smoothly
 * between whatever value it's showing and the new one on every
 * subsequent change (e.g. a realtime update), never jumping.
 */
export function AnimatedNumber({ value, formatter, durationMs = 900 }: AnimatedNumberProps) {
  const [display, setDisplay] = useState(0)
  const displayRef = useRef(0)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    const from = displayRef.current
    const to = value
    if (from === to) return

    const start = performance.now()
    function tick(now: number) {
      const elapsed = now - start
      const t = Math.min(1, elapsed / durationMs)
      // Ease-out cubic — fast start, gentle settle, reads as
      // "arriving" rather than a linear mechanical count.
      const eased = 1 - Math.pow(1 - t, 3)
      const current = from + (to - from) * eased
      displayRef.current = current
      setDisplay(current)
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick)
      }
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
  }, [value, durationMs])

  return <>{formatter(display)}</>
}
