import type { Metadata } from "next";
import type { CSSProperties, ReactNode } from "react";
import { Space_Grotesk } from "next/font/google";

// Shared metadata for auth pages (login / signup / forgot-password).
// None of these should be indexed — they'd compete with the marketing
// landing in SERPs and offer nothing to a searcher who hasn't already
// signed up. Each page still gets its own <title> via its own
// metadata.title override below the route group layout.
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
};

// Display face for the login redesign's headline/wordmark — loaded
// only here (not the root layout) since these three auth pages are
// its only consumers. `--font-heading` already exists as a Tailwind
// utility (`font-heading`, mapped in globals.css's `@theme inline`
// block) but defaults to `--font-sans` (Inter) everywhere else in the
// app; overriding it to this variable ONLY within this layout's
// subtree lets `font-heading` "just work" in the login page without
// touching the global theme or any shared component.
const spaceGrotesk = Space_Grotesk({
  variable: "--font-display",
  subsets: ["latin"],
});

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div
      className={spaceGrotesk.variable}
      style={{ "--font-heading": "var(--font-display)" } as CSSProperties}
    >
      {children}
    </div>
  );
}
