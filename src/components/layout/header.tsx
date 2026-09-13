"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import { useLocale } from "next-intl";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/hooks/use-theme";
import type { Mode } from "@/lib/themes";
import {
  Globe,
  LogOut,
  Menu,
  Moon,
  Settings as SettingsIcon,
  Sun,
  User,
} from "lucide-react";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SUPPORTED_LOCALES,
  LOCALE_LABELS,
  type SupportedLocale,
} from "@/lib/i18n/locales";

const pageTitles: Record<string, string> = {
  "/dashboard": "dashboard",
  "/inbox": "inbox",
  "/notifications": "notifications",
  "/contacts": "contacts",
  "/calendar": "calendar",
  "/pipelines": "pipelines",
  "/broadcasts": "broadcasts",
  "/automations": "automations",
  "/flows": "flows",
  "/agents": "agents",
  "/settings": "settings",
};

function getPageTitleKey(pathname: string): string {
  if (pageTitles[pathname]) return pageTitles[pathname];
  const match = Object.entries(pageTitles).find(([path]) =>
    pathname.startsWith(path),
  );
  return match ? match[1] : "dashboard";
}

interface HeaderProps {
  /** Wired to the shell's drawer state. Used only on mobile — the
   *  hamburger button is hidden on lg+. */
  onOpenSidebar?: () => void;
}

import { useTranslations } from "next-intl";

export function Header({ onOpenSidebar }: HeaderProps) {
  const t = useTranslations("Header");
  const pathname = usePathname();
  const { profile, signOut } = useAuth();
  const titleKey = getPageTitleKey(pathname);

  // Language + appearance now live inside the account dropdown below
  // (see its DropdownMenuRadioGroup sections) instead of as separate
  // header buttons — one place for "everything about how I see this
  // app", triggered off the user's own name rather than a row of
  // anonymous icons.
  const router = useRouter();
  const currentLocale = useLocale();
  const [localePending, startLocaleTransition] = useTransition();
  const { mode, setMode } = useTheme();

  const handleLocaleChange = (locale: string) => {
    if (locale === currentLocale || localePending) return;
    startLocaleTransition(async () => {
      await fetch("/api/locale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale }),
      });
      router.refresh();
    });
  };

  const initial =
    profile?.full_name?.charAt(0)?.toUpperCase() ??
    profile?.email?.charAt(0)?.toUpperCase() ??
    "U";

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 bg-background px-4 lg:px-6">
      <div className="flex min-w-0 items-center gap-2">
        {/* Hamburger — mobile only. 44×44 hit target per Apple HIG. */}
        <button
          type="button"
          onClick={onOpenSidebar}
          aria-label={t("openMenu")}
          className="flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>
        {/* The dashboard page renders its own "Welcome back" heading in
            the body, so the header's generic page title would just
            duplicate it — omit it there only. */}
        {titleKey !== "dashboard" && (
          <h1 className="truncate text-base font-semibold text-foreground sm:text-lg">
            {t(titleKey as string)}
          </h1>
        )}
      </div>

      <div className="flex items-center gap-1 sm:gap-2">
        <DropdownMenu>
        <DropdownMenuTrigger
          className="flex items-center gap-2 rounded-md px-1 py-1 transition-colors hover:bg-muted/70 focus:bg-muted/70 focus:outline-none data-popup-open:bg-muted/70 sm:gap-3 sm:pl-1 sm:pr-3"
          aria-label={t("openAccountMenu")}
        >
          <Avatar className="size-8">
            {profile?.avatar_url ? (
              <AvatarImage
                src={profile.avatar_url}
                alt={profile.full_name ?? t("defaultAvatar")}
              />
            ) : null}
            <AvatarFallback className="bg-primary/10 text-sm font-medium text-primary">
              {initial}
            </AvatarFallback>
          </Avatar>
          <span className="hidden text-sm font-medium text-foreground sm:inline">
            {profile?.full_name ?? t("defaultUser")}
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          sideOffset={6}
          className="min-w-56 bg-popover text-popover-foreground ring-border"
        >
          <div className="px-2 py-1.5">
            <p className="truncate text-sm font-medium text-foreground">
              {profile?.full_name ?? t("defaultUser")}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {profile?.email ?? ""}
            </p>
          </div>
          <DropdownMenuSeparator className="bg-border" />
          <DropdownMenuItem
            render={
              <Link
                href="/settings?tab=profile"
                className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
              />
            }
          >
            <User className="size-4" />
            {t("menuProfile")}
          </DropdownMenuItem>
          <DropdownMenuItem
            render={
              <Link
                href="/settings?tab=integrations"
                className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
              />
            }
          >
            <SettingsIcon className="size-4" />
            {t("menuSettings")}
          </DropdownMenuItem>

          <DropdownMenuSeparator className="bg-border" />
          <DropdownMenuGroup>
            <DropdownMenuLabel className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Globe className="size-3.5" />
              {t("menuLanguage")}
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={currentLocale}
              onValueChange={(value) => handleLocaleChange(value as SupportedLocale)}
            >
              {SUPPORTED_LOCALES.map((locale) => (
                <DropdownMenuRadioItem
                  key={locale}
                  value={locale}
                  disabled={localePending}
                  className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
                >
                  {LOCALE_LABELS[locale]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>

          <DropdownMenuSeparator className="bg-border" />
          <DropdownMenuGroup>
            <DropdownMenuLabel className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {mode === "dark" ? <Moon className="size-3.5" /> : <Sun className="size-3.5" />}
              {t("menuAppearance")}
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={mode}
              onValueChange={(value) => setMode(value as Mode)}
            >
              <DropdownMenuRadioItem
                value="light"
                className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
              >
                {t("modeLight")}
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem
                value="dark"
                className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
              >
                {t("modeDark")}
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>

          <DropdownMenuSeparator className="bg-border" />
          <DropdownMenuItem
            onClick={signOut}
            className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
          >
            <LogOut className="size-4" />
            {t("menuSignOut")}
          </DropdownMenuItem>
        </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
