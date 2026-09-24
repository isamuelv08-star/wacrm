"use client";

import { useTranslations } from "next-intl";
import { CURRENCIES } from "@/lib/currency";
import { Label } from "@/components/ui/label";

interface CurrencyConfirmProps {
  value: string;
  onChange: (currency: string) => void;
}

/**
 * Onboarding's currency suggestion+confirm control — Saleslid guesses
 * from the browser's locale (see guessCurrencyFromLocale) and shows
 * it pre-selected here; the user confirms or picks another. Without
 * this the account silently keeps the DB's 'USD' default forever
 * (never asked, never detected) — wrong for most of this app's actual
 * customer base.
 */
export function CurrencyConfirm({ value, onChange }: CurrencyConfirmProps) {
  const t = useTranslations("Onboarding.businessType");

  return (
    <div className="mt-4 grid gap-2 sm:max-w-xs">
      <Label className="text-muted-foreground">{t("currencyLabel")}</Label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
      >
        {CURRENCIES.map((c) => (
          <option key={c.code} value={c.code}>
            {c.code} — {c.label}
          </option>
        ))}
      </select>
    </div>
  );
}
