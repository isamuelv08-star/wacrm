"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Target } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { formatCurrency } from "@/lib/currency";
import { monthKey } from "@/lib/dashboard/date-utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { useTranslations } from "next-intl";
import { SettingsPanelHead } from "./settings-panel-head";
import type { AccountMember } from "@/types";

interface GoalRow {
  id: string;
  target_value: number;
}

/**
 * Monthly sales targets — the account-wide goal, plus one per member,
 * that drive the /ceo dashboard's META / FORECAST KPIs and the Top
 * Sellers leaderboard (migration 053). Nothing in the data model can
 * infer these; an admin+ has to enter them, same posture as the
 * account's default currency in DealsSettings.
 *
 * Always edits the CURRENT calendar month — the CEO dashboard only
 * ever reads this month's goal, so there's no month picker to keep
 * the UI from ballooning into a full quota-planning tool.
 */
export function GoalsSettings() {
  const supabase = createClient();
  const { accountId, defaultCurrency, canEditSettings, profileLoading } = useAuth();
  const t = useTranslations("Settings.goals");
  const thisMonthKey = monthKey(new Date());

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [accountGoal, setAccountGoal] = useState<GoalRow | null>(null);
  const [accountGoalInput, setAccountGoalInput] = useState("");

  const [members, setMembers] = useState<AccountMember[]>([]);
  const [memberGoals, setMemberGoals] = useState<Record<string, GoalRow | null>>({});
  const [memberInputs, setMemberInputs] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    try {
      const [membersRes, goalsRes] = await Promise.all([
        fetch("/api/account/members", { cache: "no-store" }),
        supabase
          .from("sales_goals")
          .select("id, user_id, target_value")
          .eq("period_month", thisMonthKey),
      ]);

      if (membersRes.ok) {
        const data = (await membersRes.json()) as { members: AccountMember[] };
        setMembers(data.members);
      }

      if (goalsRes.error) {
        toast.error(t("loadFailed"));
      } else {
        const rows = (goalsRes.data ?? []) as { id: string; user_id: string | null; target_value: number }[];
        const account = rows.find((r) => r.user_id === null) ?? null;
        setAccountGoal(account ? { id: account.id, target_value: account.target_value } : null);
        setAccountGoalInput(account ? String(account.target_value) : "");

        const byMember: Record<string, GoalRow | null> = {};
        const inputs: Record<string, string> = {};
        for (const r of rows) {
          if (!r.user_id) continue;
          byMember[r.user_id] = { id: r.id, target_value: r.target_value };
          inputs[r.user_id] = String(r.target_value);
        }
        setMemberGoals(byMember);
        setMemberInputs((prev) => ({ ...inputs, ...prev }));
      }
    } finally {
      setLoading(false);
    }
  }, [accountId, thisMonthKey, supabase, t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function upsertGoal(userId: string | null, existing: GoalRow | null, value: number) {
    if (existing) {
      return supabase.from("sales_goals").update({ target_value: value }).eq("id", existing.id);
    }
    return supabase.from("sales_goals").insert({
      user_id: userId,
      period_month: thisMonthKey,
      target_value: value,
      currency: defaultCurrency,
    });
  }

  async function handleSave() {
    setSaving(true);
    try {
      const writes: Promise<{ error: { message: string } | null }>[] = [];

      const accountValue = Number(accountGoalInput);
      if (accountGoalInput.trim() !== "" && !Number.isNaN(accountValue) && accountValue >= 0) {
        writes.push(upsertGoal(null, accountGoal, accountValue));
      }

      for (const m of members) {
        const raw = memberInputs[m.user_id];
        if (raw === undefined || raw.trim() === "") continue;
        const value = Number(raw);
        if (Number.isNaN(value) || value < 0) continue;
        const existing = memberGoals[m.user_id] ?? null;
        // Skip untouched rows — a member with no goal set and an empty
        // input shouldn't create a $0 row.
        if (!existing && value === 0) continue;
        writes.push(upsertGoal(m.user_id, existing, value));
      }

      const results = await Promise.all(writes);
      if (results.some((r) => r.error)) {
        toast.error(t("saveFailed"));
        return;
      }
      toast.success(t("saveSuccess"));
      await load();
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="max-w-2xl animate-in fade-in-50 duration-200">
      <SettingsPanelHead title={t("title")} description={t("description")} />

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-foreground">
              <Target className="size-4 text-primary" />
              {t("accountGoal")}
            </CardTitle>
            <CardDescription className="text-muted-foreground">
              {t("accountGoalDesc")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 sm:max-w-xs">
              <Label className="text-muted-foreground">
                {t("monthlyTargetLabel", { currency: defaultCurrency })}
              </Label>
              <Input
                type="number"
                min={0}
                value={accountGoalInput}
                onChange={(e) => setAccountGoalInput(e.target.value)}
                disabled={!canEditSettings || profileLoading || loading}
                placeholder="0"
                className="bg-muted text-foreground"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-foreground">{t("memberGoals")}</CardTitle>
            <CardDescription className="text-muted-foreground">
              {t("memberGoalsDesc")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : members.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noMembers")}</p>
            ) : (
              <ul className="space-y-3">
                {members.map((m) => (
                  <li key={m.user_id} className="flex items-center gap-3">
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                      {m.full_name || m.email || t("unnamed")}
                    </span>
                    <Input
                      type="number"
                      min={0}
                      value={memberInputs[m.user_id] ?? ""}
                      onChange={(e) =>
                        setMemberInputs((prev) => ({ ...prev, [m.user_id]: e.target.value }))
                      }
                      disabled={!canEditSettings || profileLoading}
                      placeholder="0"
                      className="w-32 bg-muted text-foreground"
                    />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {!canEditSettings && (
          <p className="text-xs text-muted-foreground">{t("adminOnlyHint")}</p>
        )}

        {canEditSettings && (
          <Button
            onClick={handleSave}
            disabled={saving || loading}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {saving ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                {t("saving")}
              </>
            ) : (
              t("save")
            )}
          </Button>
        )}

        {accountGoal && (
          <p className="text-xs text-muted-foreground">
            {t("currentGoalHint", { value: formatCurrency(accountGoal.target_value, defaultCurrency) })}
          </p>
        )}
      </div>
    </section>
  );
}
