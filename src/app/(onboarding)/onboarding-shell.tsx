"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { consumePendingInviteToken } from "@/lib/auth/pending-invite";

// Chrome-free auth-gated shell for the onboarding wizard — no
// sidebar/header (unlike DashboardShell), same "redirect to /login if
// signed out" guard. Mounts its own <AuthProvider>: this route group
// is a sibling of (dashboard), not nested under it, so nothing above
// it in the tree already provides one (see (auth)/layout.tsx for the
// precedent of a chrome-free sibling group).
function OnboardingShellInner({ children }: { children: React.ReactNode }) {
  const t = useTranslations("DashboardShell");
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [user, loading, router]);

  // Defense-in-depth against DashboardShell's own check (see its
  // pending-invite comment): if a visitor with a pending invite
  // somehow lands here directly — a bookmarked /onboarding URL, a
  // stale tab — send them to finish accepting instead of starting
  // the "set up your business" wizard on their throwaway personal
  // account.
  useEffect(() => {
    if (!loading && user) {
      const pendingInviteToken = consumePendingInviteToken();
      if (pendingInviteToken) {
        router.push(`/join/${encodeURIComponent(pendingInviteToken)}`);
      }
    }
  }, [loading, user, router]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">{t("loading")}</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-4 py-10 sm:px-6">
        {children}
      </main>
    </div>
  );
}

export function OnboardingShell({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <OnboardingShellInner>{children}</OnboardingShellInner>
    </AuthProvider>
  );
}
