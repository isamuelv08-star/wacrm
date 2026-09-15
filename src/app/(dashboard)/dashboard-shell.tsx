"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { PresenceHeartbeat } from "@/components/presence/presence-heartbeat";
import { NewNotificationToastListener } from "@/components/notifications/new-notification-toast-listener";
import { consumePendingInviteToken } from "@/lib/auth/pending-invite";

// Auth-gated dashboard shell. Extracted from the layout so the layout
// itself can stay a server component and export metadata (noindex) —
// client components can't export Next's metadata object.

function DashboardShellInner({ children }: { children: React.ReactNode }) {
  const t = useTranslations("DashboardShell");
  const { user, loading, profileLoading, account } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  // Sidebar drawer state — only used on mobile. On lg+ the sidebar is
  // always visible and this stays at `false` (ignored by the component).
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [user, loading, router]);

  // First-run onboarding gate (migration 063), plus the restricted-
  // access gate (migration 088) — both account-scoped, not per-user.
  // Gated on `profileLoading` so we don't redirect during the brief
  // window before the account row has loaded.
  //
  // Before acting on either gate, check for a pending invite token
  // (see @/lib/auth/pending-invite). A visitor who arrived via
  // /join/<token> should never see "set up your business" OR
  // "access restricted" — that page's normal flow is signup/login →
  // back to /join/<token> → accept, but if that redirect chain got
  // dropped (email-confirmation redirect not on Supabase's allow-
  // list, link opened in a new tab, ...) they land here instead, on
  // a fresh personal account that a from-scratch signup would also
  // produce (status 'pending', onboarding_completed_at NULL). Route
  // them back to finish accepting the invite rather than treating
  // that throwaway account as either un-onboarded or un-approved.
  // One-shot (`consume` clears it): if accepting fails, the next
  // visit falls through to the normal gates below instead of
  // looping.
  //
  // Only once there's no pending invite to resume: a non-'active'
  // account (self-signed-up, not yet approved — or suspended) goes
  // to /acceso-restringido instead of onboarding; an 'active' but
  // un-onboarded account goes to /onboarding as before.
  useEffect(() => {
    if (loading || !user || profileLoading || !account) return;
    if (account.status === "active" && account.onboarding_completed_at) return;

    const pendingInviteToken = consumePendingInviteToken();
    if (pendingInviteToken) {
      router.push(`/join/${encodeURIComponent(pendingInviteToken)}`);
    } else if (account.status !== "active") {
      router.push("/acceso-restringido");
    } else {
      router.push("/onboarding");
    }
  }, [loading, user, profileLoading, account, router]);

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

  // Avoid a one-frame flash of dashboard chrome while the onboarding
  // or restricted-access redirect above is in flight.
  if (!profileLoading && account && (account.status !== "active" || !account.onboarding_completed_at)) {
    return null;
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Reports this tab's online/away presence once we know a user is
          signed in. Headless — renders nothing. */}
      <PresenceHeartbeat />
      {/* Toasts every new notification in real time (assignments, HOT
          lead alerts, ...) in addition to the Notifications bandeja.
          Headless — renders nothing. */}
      <NewNotificationToastListener />
      <Sidebar open={sidebarOpen} onClose={closeSidebar} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header onOpenSidebar={() => setSidebarOpen(true)} />
        {/* Thinner horizontal padding on mobile so cards have room to breathe.
            The inner div is keyed on the route so switching pages (sidebar
            nav, not just a search-param change like picking a different
            inbox conversation) always mounts a fresh element and replays
            the fade-in — without it, `main` itself never remounts and the
            page swap has no transition at all (see globals.css). */}
        <main className="themed-scrollbar flex-1 overflow-y-auto p-4 sm:p-6">
          <div key={pathname} className="page-transition">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <DashboardShellInner>{children}</DashboardShellInner>
    </AuthProvider>
  );
}
