"use client"

import { useEffect, useState, type ReactNode } from 'react'

interface RevealSectionProps {
  children: ReactNode
  /** Stagger this section behind earlier ones on the page. */
  delayMs?: number
  className?: string
}

/**
 * Fades + slides a dashboard section in on mount, so the page reads
 * as a cascade of panels arriving rather than everything popping in
 * at once. Purely presentational — plays once per mount, independent
 * of whether the section's own data has finished loading (a section
 * still shows its own skeleton underneath while this transition
 * runs).
 */
export function RevealSection({ children, delayMs = 0, className }: RevealSectionProps) {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const raf = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div
      className={className}
      style={{
        opacity: shown ? 1 : 0,
        transform: shown ? 'translateY(0)' : 'translateY(10px)',
        transition: 'opacity 550ms ease-out, transform 550ms ease-out',
        transitionDelay: `${delayMs}ms`,
      }}
    >
      {children}
    </div>
  )
}
