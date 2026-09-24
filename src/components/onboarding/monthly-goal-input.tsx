"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { monthKey } from "@/lib/dashboard/date-utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Onboarding's optional monthly-goal field — the account-wide row in
 * `sales_goals` (user_id null) that drives the CEO dashboard's META /
 * FORECAST KPIs (migration 053). Nobody but the business owner knows
 * this number, so unlike currency/timezone there's nothing to detect
 * — it's asked once, plainly ("¿Cuánto querés vender este mes?" per
 * the onboarding audit's microcopy section), and left entirely
 * optional since a brand-new account may not have a number in mind
 * yet.
 */
export function MonthlyGoalInput({ currency }: { currency: string }) {
  const t = useTranslations("Onboarding.businessType");
  const supabase = createClient();
  const { accountId } = useAuth();
  const thisMonthKey = monthKey(new Date());

  const [value, setValue] = useState("");
  const existingId = useRef<string | null>(null);

  useEffect(() => {
    if (!accountId) return;
    (async () => {
      const { data } = await supabase
        .from("sales_goals")
        .select("id, target_value")
        .eq("account_id", accountId)
        .is("user_id", null)
        .eq("period_month", thisMonthKey)
        .maybeSingle();
      if (data) {
        existingId.current = data.id;
        setValue(String(data.target_value));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  async function handleBlur() {
    if (!accountId) return;
    const trimmed = value.trim();
    if (trimmed === "") return;
    const parsed = Number(trimmed);
    if (Number.isNaN(parsed) || parsed < 0) return;

    if (existingId.current) {
      await supabase
        .from("sales_goals")
        .update({ target_value: parsed })
        .eq("id", existingId.current);
      return;
    }
    // account_id NOT NULL + the insert RLS policy checks
    // is_account_member(account_id, 'admin') — same shape as
    // GoalsSettings' own upsertGoal.
    const { data } = await supabase
      .from("sales_goals")
      .insert({
        account_id: accountId,
        user_id: null,
        period_month: thisMonthKey,
        target_value: parsed,
        currency,
      })
      .select("id")
      .single();
    if (data) existingId.current = data.id;
  }

  return (
    <div className="mt-4 grid gap-2 sm:max-w-xs">
      <Label className="text-muted-foreground">{t("monthlyGoalLabel")}</Label>
      <Input
        type="number"
        min={0}
        inputMode="numeric"
        placeholder={t("monthlyGoalPlaceholder")}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => void handleBlur()}
      />
    </div>
  );
}
