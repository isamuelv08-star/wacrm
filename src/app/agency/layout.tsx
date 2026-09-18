import type { Metadata } from "next";
import { AgencyShell } from "./agency-shell";

// Same "do not index" posture as (dashboard)/layout.tsx — this surface
// is even more sensitive (cross-account super-admin data), so belt-
// and-suspenders here matters at least as much.
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

export default function AgencyLayout({ children }: { children: React.ReactNode }) {
  return <AgencyShell>{children}</AgencyShell>;
}
