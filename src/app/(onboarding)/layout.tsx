import type { Metadata } from "next";
import { OnboardingShell } from "./onboarding-shell";

// Same "belt-and-suspenders" noindex as the dashboard layout — this
// is authed, per-account setup, never meant to be crawled or shared.
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

export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <OnboardingShell>{children}</OnboardingShell>;
}
