"use client";

import { useCallback, useState } from "react";
import { Menu } from "lucide-react";
import { useTranslations } from "next-intl";
import { AgencySidebar } from "@/components/agency/agency-sidebar";

/**
 * Client wrapper around `AgencySidebar` — holds the mobile-drawer open
 * state and renders the small top bar (logo-free; the sidebar already
 * carries the logo) that exposes the hamburger on small screens. Split
 * out from `layout.tsx` so that file can stay a server component
 * (metadata export), same reasoning as (dashboard)/dashboard-shell.tsx.
 */
export function AgencyShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations("Agency.sidebar");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <AgencySidebar open={sidebarOpen} onClose={closeSidebar} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4 lg:hidden">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            aria-label={t("openMenu")}
            className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Menu className="h-5 w-5" />
          </button>
          <span className="text-sm font-semibold text-foreground">{t("productName")}</span>
        </div>
        <main className="themed-scrollbar flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
