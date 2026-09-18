"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Building2,
  Headset,
  LogOut,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

interface AgencySidebarProps {
  /** Controlled on mobile by AgencyShell's hamburger button. Ignored on lg+. */
  open?: boolean;
  onClose?: () => void;
}

/**
 * Sidebar chrome for the standalone agency panel (`/agency`). NOT the
 * app's regular `Sidebar` (src/components/layout/sidebar.tsx) — that
 * one is built entirely around `useAuth()`'s per-account profile/role,
 * which doesn't apply here (the agency owner's session isn't
 * necessarily a member of any one client account; see
 * requireSuperAdmin's doc comment). This one only ever needs the
 * signed-in super admin's own email, fetched directly rather than
 * through the account-scoped auth context.
 *
 * Only one destination exists today (`/agency` itself), so the nav
 * list is a single item — kept as a list (not hardcoded chrome) so a
 * second agency-only page slots in the same way the main app's
 * Sidebar grows.
 */
export function AgencySidebar({ open = false, onClose }: AgencySidebarProps) {
  const t = useTranslations("Agency.sidebar");
  const pathname = usePathname();
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [openSupportCount, setOpenSupportCount] = useState(0);

  useEffect(() => {
    let alive = true;
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      if (alive) setEmail(data.user?.email ?? null);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Badge count for the "Soporte" nav item — fetched once on mount, no
  // realtime (this panel is a single super admin checking in, not a
  // multi-viewer live dashboard; a manual refresh/revisit is enough).
  useEffect(() => {
    let alive = true;
    fetch("/api/agency/support-requests")
      .then((res) => (res.ok ? res.json() : null))
      .then((payload: { requests?: { status: string }[] } | null) => {
        if (!alive || !payload?.requests) return;
        setOpenSupportCount(payload.requests.filter((r) => r.status === "open").length);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  const navItems = [
    { href: "/agency", labelKey: "overview", icon: Building2 },
    { href: "/agency/support", labelKey: "support", icon: Headset },
  ];

  return (
    <>
      <button
        type="button"
        aria-label={t("closeMenu")}
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-30 bg-background/70 backdrop-blur-sm transition-opacity lg:hidden",
          open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
        )}
      />

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex h-full w-64 flex-col border-r border-border bg-card",
          "transition-transform duration-200 ease-out will-change-transform",
          open ? "translate-x-0" : "-translate-x-full",
          "lg:static lg:z-0 lg:m-3 lg:h-[calc(100%-1.5rem)] lg:w-60 lg:translate-x-0",
          "lg:rounded-2xl lg:border lg:border-border lg:shadow-lg lg:shadow-black/5",
        )}
        aria-label="Primary"
      >
        {/* Logo row — Saleslid CRM branding + an "Agency" badge so this
            never gets mistaken for the regular client-facing app, even
            though it can share a visual identity with it. */}
        <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border px-4">
          <div className="flex items-center gap-2">
            <img src="/logo-mark.png" alt="" className="h-8 w-8 shrink-0 object-contain" />
            <div className="flex flex-col leading-tight">
              <span className="text-sm font-semibold text-foreground">{t("productName")}</span>
              <span className="text-[10px] font-medium uppercase tracking-wider text-primary">
                {t("badge")}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("closeMenu")}
            className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <ul className="flex flex-col gap-1">
            {navItems.map((item) => {
              const isActive = pathname === item.href;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors lg:py-2",
                      isActive
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    <span className="flex-1">{t(item.labelKey)}</span>
                    {item.href === "/agency/support" && openSupportCount > 0 && (
                      <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500/15 px-1 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                        {openSupportCount}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* About-the-app blurb — what this panel is, for whenever a
            second agency admin needs the context a lone super-admin
            already has in their head. */}
        <div className="shrink-0 border-t border-border p-3">
          <div className="rounded-lg bg-muted/40 p-3">
            <p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
              <Headset className="h-3.5 w-3.5 text-primary" />
              {t("aboutTitle")}
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              {t("aboutBody")}
            </p>
          </div>
        </div>

        {/* Signed-in super admin + sign out — this panel has no other
            way back to /login, unlike the main app's Sidebar user menu. */}
        <div className="shrink-0 border-t border-border p-3">
          <div className="flex items-center justify-between gap-2 rounded-lg px-3 py-2">
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {t("signedInAs")}
              </p>
              <p className="truncate text-xs font-medium text-foreground" title={email ?? ""}>
                {email ?? "—"}
              </p>
            </div>
            <button
              type="button"
              onClick={handleSignOut}
              aria-label={t("signOut")}
              title={t("signOut")}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-red-500"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
