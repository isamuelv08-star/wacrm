"use client";

// ============================================================
// /acceso-restringido — where DashboardShell sends any signed-in
// user whose account.status isn't 'active' (migration 088). Two
// cases:
//   'pending'   — signed up on their own, no owner invite. Normal
//                 outcome while self-serve signup is closed; the
//                 agency owner sees them in /agency and activates
//                 manually (see AccountDetailSheet's status action).
//   'suspended' — was active, access revoked.
// Chrome-free, mounts its own <AuthProvider> — sibling of (dashboard)
// and (onboarding), same shape as OnboardingShell.
// ============================================================

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, MailIcon } from "lucide-react";

import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { BrandMark } from "@/components/ui/brand-mark";
import { Button } from "@/components/ui/button";

const SUPPORT_EMAIL = "soporte@saleslid.com";

function RestrictedAccessInner() {
  const t = useTranslations("RestrictedAccess");
  const { user, loading, profileLoading, account, signOut } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [user, loading, router]);

  // Safety valve: an account activated (or reactivated) while this tab
  // was already open shouldn't leave the visitor stranded here.
  useEffect(() => {
    if (!profileLoading && account?.status === "active") {
      router.push("/dashboard");
    }
  }, [profileLoading, account, router]);

  if (loading || profileLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user || !account || account.status === "active") return null;

  const isSuspended = account.status === "suspended";

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 text-center shadow-lg shadow-black/5">
        <BrandMark className="mx-auto" />
        <h1 className="mt-4 text-lg font-semibold text-foreground">
          {isSuspended ? t("suspendedTitle") : t("pendingTitle")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {isSuspended ? t("suspendedDesc") : t("pendingDesc")}
        </p>

        <a
          href={`mailto:${SUPPORT_EMAIL}`}
          className="mt-5 flex items-center justify-center gap-2 rounded-lg border border-border bg-muted px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted/70"
        >
          <MailIcon className="size-4" />
          {SUPPORT_EMAIL}
        </a>

        <Button
          type="button"
          variant="ghost"
          className="mt-4 w-full text-muted-foreground"
          onClick={() => void signOut()}
        >
          {t("signOut")}
        </Button>
      </div>
    </div>
  );
}

export default function RestrictedAccessPage() {
  return (
    <AuthProvider>
      <RestrictedAccessInner />
    </AuthProvider>
  );
}
