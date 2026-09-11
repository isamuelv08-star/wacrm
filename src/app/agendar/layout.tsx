// ============================================================
// /agendar/[slug] layout — minimal public shell for the self-service
// booking page (migration 079). Sits outside (auth)/(dashboard) for
// the same reason /join does: it must render for anonymous visitors
// with no account context at all, so neither of those layouts' auth
// redirects apply here.
// ============================================================

import type { Metadata } from 'next'
import type { ReactNode } from 'react'

export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

export default function BookingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background px-4 py-8 sm:py-12">
      <div className="mx-auto w-full max-w-lg">{children}</div>
    </div>
  )
}
