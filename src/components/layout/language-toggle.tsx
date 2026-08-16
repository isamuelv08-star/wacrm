"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Check, Globe } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SUPPORTED_LOCALES,
  LOCALE_LABELS,
  type SupportedLocale,
} from "@/lib/i18n/locales";

/**
 * App-wide language picker (English/Español/Português). Unlike
 * ModeToggle, the choice can't just flip a data-attribute client-side —
 * every string on the page comes from server-rendered messages
 * (NextIntlClientProvider in the root layout), so switching locale
 * means: persist the choice in a cookie the server reads on the next
 * request (/api/locale → src/i18n/request.ts), then router.refresh()
 * so the whole tree re-renders with the new dictionary.
 */
export function LanguageToggle({ className }: { className?: string }) {
  const t = useTranslations("LanguageToggle");
  const router = useRouter();
  const currentLocale = useLocale();
  const [isPending, startTransition] = useTransition();

  const handleSelect = (locale: SupportedLocale) => {
    if (locale === currentLocale || isPending) return;
    startTransition(async () => {
      await fetch("/api/locale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale }),
      });
      router.refresh();
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t("ariaLabel")}
        title={t("ariaLabel")}
        className={cn(
          "flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50",
          className,
        )}
        disabled={isPending}
      >
        <Globe className="h-5 w-5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={6}
        className="min-w-40 bg-popover text-popover-foreground ring-border"
      >
        {SUPPORTED_LOCALES.map((locale) => (
          <DropdownMenuItem
            key={locale}
            onClick={() => handleSelect(locale)}
            className="flex items-center justify-between gap-2 text-popover-foreground focus:bg-accent focus:text-accent-foreground"
          >
            {LOCALE_LABELS[locale]}
            {locale === currentLocale && <Check className="h-4 w-4" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
