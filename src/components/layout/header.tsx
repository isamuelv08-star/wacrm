"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
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
import { SmartSearch } from "@/components/layout/smart-search";
import { LiveClock } from "@/components/layout/live-clock";
import { NotificationsBell } from "@/components/layout/notifications-bell";

interface HeaderProps {
  /** Wired to the shell's drawer state. Used only on mobile — the
   *  hamburger button is hidden on lg+. */
  onOpenSidebar?: () => void;
}

/**
 * Global top bar — search + live clock on the left, settings
 * (language/appearance) + notifications + account menu grouped on the
 * right. Per-page identity (the "Contactos"/"Pipelines" heading this
 * used to show) now lives in each page's own body instead — every
 * page under (dashboard) already renders its own title there (or, for
 * Pipelines, its pipeline-name selector), so nothing was lost by
 * dropping the duplicate here.
 */
export function Header({ onOpenSidebar }: HeaderProps) {
  const t = useTranslations("Header");
  const { profile, signOut } = useAuth();

  // Language + appearance live in the settings (gear) dropdown; the
  // account dropdown is just identity + sign out.
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
    <header className="flex h-14 shrink-0 items-center gap-3 bg-background px-4 lg:px-6">
      {/* Hamburger — mobile only. 44×44 hit target per Apple HIG. */}
      <button
        type="button"
        onClick={onOpenSidebar}
        aria-label={t("openMenu")}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>

      <SmartSearch />
      <LiveClock />

      <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
        {/* Settings — language + appearance, off a plain gear icon
            rather than buried in the account menu. */}
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={t("openSettingsMenu")}
            className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none data-popup-open:bg-muted"
          >
            <SettingsIcon className="h-4.5 w-4.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            sideOffset={8}
            className="min-w-56 bg-popover text-popover-foreground ring-border"
          >
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
          </DropdownMenuContent>
        </DropdownMenu>

        <NotificationsBell />

        {/* Account — identity + sign out only. */}
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={t("openAccountMenu")}
            className="flex h-9 w-9 items-center justify-center rounded-full transition-opacity hover:opacity-80 focus:outline-none data-popup-open:opacity-80"
          >
            <Avatar className="size-9">
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
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            sideOffset={8}
            className="min-w-52 bg-popover text-popover-foreground ring-border"
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
