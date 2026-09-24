"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { WhatsAppChannelOptions } from "@/components/settings/whatsapp-channel-options";
import { GoogleCalendarConnect } from "@/components/settings/google-calendar-connect";
import { InviteMemberDialog } from "@/components/settings/invite-member-dialog";
import { AiToneStep } from "./ai-tone-step";
import { BusinessTypeStep } from "./business-type-step";
import { CurrencyConfirm } from "./currency-confirm";
import { FirstDiagnosisStep } from "./first-diagnosis-step";
import { MonthlyGoalInput } from "./monthly-goal-input";
import { PipelineStep } from "./pipeline-step";
import { WhatsAppModeStep, type WhatsAppMode } from "./whatsapp-mode-step";
import { useAuth } from "@/hooks/use-auth";
import { createClient } from "@/lib/supabase/client";
import { DEFAULT_CURRENCY, guessCurrencyFromLocale } from "@/lib/currency";
import { APPOINTMENT_BASED_VERTICALS, type BusinessVertical } from "@/types";

// Order matters — business type first (decides whether "calendar"
// below is shown at all), then the WhatsApp setup choice (shared
// number vs. one per seller), then the connect step itself, since
// nothing else in the product works without a channel connected
// (inbox/broadcasts/AI auto-reply are all inert without one). The
// rest are informational/optional.
const BASE_STEP_KEYS = ["businessType", "whatsappMode", "whatsapp", "pipeline", "ai"] as const;
const TAIL_STEP_KEYS = ["invite", "done"] as const;
type StepKey =
  | (typeof BASE_STEP_KEYS)[number]
  | "calendar"
  | (typeof TAIL_STEP_KEYS)[number];

export function OnboardingWizard() {
  const t = useTranslations("Onboarding");
  const router = useRouter();
  const supabase = createClient();
  const { account, accountId } = useAuth();
  const [stepIndex, setStepIndex] = useState(0);
  const [finishing, setFinishing] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [businessVertical, setBusinessVertical] = useState<BusinessVertical | null>(
    account?.business_vertical ?? null,
  );
  const [whatsappMode, setWhatsappMode] = useState<WhatsAppMode>(
    account?.whatsapp_mode ?? "shared",
  );
  // Suggested from the browser's locale, not from account.default_currency —
  // a brand-new account's currency is always the DB's own silent 'USD'
  // default at this point, so there's nothing meaningful to read back;
  // the user confirms or changes this suggestion instead (onboarding
  // audit finding: currency was never asked OR detected before).
  const [currency, setCurrency] = useState<string>(() =>
    typeof navigator !== "undefined"
      ? guessCurrencyFromLocale(navigator.language)
      : DEFAULT_CURRENCY,
  );

  function handleSelectCurrency(next: string) {
    setCurrency(next);
    if (!accountId) return;
    void supabase.from("accounts").update({ default_currency: next }).eq("id", accountId);
  }

  // Timezone: detected and saved silently, never asked — unlike
  // currency there's no ambiguity to confirm (the browser's IANA zone
  // IS the answer), and only when the account still carries the DB's
  // silent 'UTC' default, so this never overwrites a value someone
  // already set deliberately in Settings.
  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/account");
      if (cancelled || !res.ok) return;
      const data = (await res.json()) as { account?: { timezone?: string } };
      if (data.account?.timezone !== "UTC") return;
      const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (!detected || detected === "UTC") return;
      await fetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timezone: detected }),
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  // "calendar" only shows up for appointment-driven verticals (clinics,
  // spas, travel agencies, etc. — see APPOINTMENT_BASED_VERTICALS) —
  // suggesting Google Calendar to a pure sales/retail account would be
  // noise, not help.
  const STEP_KEYS: readonly StepKey[] = useMemo(() => {
    const suggestCalendar =
      businessVertical !== null && APPOINTMENT_BASED_VERTICALS.includes(businessVertical);
    return [
      ...BASE_STEP_KEYS,
      ...(suggestCalendar ? (["calendar"] as const) : []),
      ...TAIL_STEP_KEYS,
    ];
  }, [businessVertical]);

  const step: StepKey = STEP_KEYS[stepIndex];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === STEP_KEYS.length - 1;

  // Resume where the user left off (migration 108) instead of always
  // restarting at step 0 — onboarding audit finding D.9: closing the
  // tab mid-wizard used to lose all progress except the two
  // auto-saved fields above, forcing a full repeat of every screen.
  // Runs once STEP_KEYS is known (it depends on businessVertical,
  // which resolves from `account` a beat after this component mounts).
  const resumeAttempted = useRef(false);
  useEffect(() => {
    if (!accountId || resumeAttempted.current) return;
    resumeAttempted.current = true;
    (async () => {
      const { data } = await supabase
        .from("accounts")
        .select("onboarding_current_step")
        .eq("id", accountId)
        .maybeSingle();
      const saved = data?.onboarding_current_step as string | null | undefined;
      if (!saved) return;
      const idx = STEP_KEYS.indexOf(saved as StepKey);
      if (idx > 0) setStepIndex(idx);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  // Persist progress on every step change — best-effort, same
  // fire-and-forget posture as handleSelectVertical/handleSelectWhatsAppMode.
  useEffect(() => {
    if (!accountId || !resumeAttempted.current) return;
    void fetch("/api/account", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ onboarding_current_step: step }),
    });
  }, [step, accountId]);

  function handleSelectVertical(vertical: BusinessVertical) {
    setBusinessVertical(vertical);
    // Best-effort, fire-and-forget — same posture as the rest of this
    // wizard (a failed save here just means the vertical stays unset
    // and Settings never suggested anything special; nothing blocks
    // on it). Saved immediately rather than only on "Next" so it
    // sticks even if the user skips the rest of setup right after.
    void fetch("/api/account", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ business_vertical: vertical }),
    });
  }

  function handleSelectWhatsAppMode(mode: WhatsAppMode) {
    setWhatsappMode(mode);
    // Same best-effort, fire-and-forget posture as handleSelectVertical.
    void fetch("/api/account", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ whatsapp_mode: mode }),
    });
  }

  // Marks the account onboarded and leaves the wizard — used by both
  // "Skip setup" (from any step) and the final step's CTA. Best-effort:
  // even if the request fails, don't trap the user here — they'll just
  // see the wizard again next login, which is safe (the column stays
  // NULL, nothing else depends on it).
  //
  // Lands on Centro de Decisiones, not /dashboard (onboarding audit
  // section 13/Fase 5) — "ya conocemos lo suficiente de tu operación,
  // ahora vamos a mostrarte dónde deberías prestar atención" applies
  // whether the user finished the wizard or skipped straight out of
  // it; either way this is their first real session.
  const complete = async () => {
    setFinishing(true);
    try {
      await fetch("/api/onboarding/complete", { method: "POST" });
    } finally {
      router.push("/dashboard/centro-de-decisiones");
    }
  };

  const goNext = () => {
    if (isLast) {
      complete();
      return;
    }
    setStepIndex((i) => i + 1);
  };

  const goBack = () => {
    setStepIndex((i) => Math.max(0, i - 1));
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5" aria-hidden>
          {STEP_KEYS.map((key, i) => (
            <span
              key={key}
              className={`h-1.5 rounded-full transition-all ${
                i === stepIndex
                  ? "w-6 bg-primary"
                  : i < stepIndex
                    ? "w-1.5 bg-primary/50"
                    : "w-1.5 bg-border"
              }`}
            />
          ))}
        </div>
        {!isLast && (
          <button
            type="button"
            onClick={complete}
            disabled={finishing}
            className="text-sm text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
          >
            {t("skipSetup")}
          </button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t(`${step}.title`)}</CardTitle>
          <CardDescription>{t(`${step}.description`)}</CardDescription>
        </CardHeader>
        <CardContent>
          {step === "businessType" && (
            <>
              <BusinessTypeStep value={businessVertical} onChange={handleSelectVertical} />
              <CurrencyConfirm value={currency} onChange={handleSelectCurrency} />
              <MonthlyGoalInput currency={currency} />
            </>
          )}

          {step === "whatsappMode" && (
            <WhatsAppModeStep value={whatsappMode} onChange={handleSelectWhatsAppMode} />
          )}

          {step === "whatsapp" && (
            <div className="flex flex-col gap-3">
              {whatsappMode === "multiwhatsapp" && (
                <p className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
                  {t("whatsapp.multiwhatsappHint")}
                </p>
              )}
              <WhatsAppChannelOptions />
            </div>
          )}

          {step === "pipeline" && <PipelineStep />}

          {step === "ai" && <AiToneStep />}

          {step === "calendar" && (
            <div className="flex flex-col items-start gap-3">
              <p className="text-sm text-muted-foreground">
                {t("calendar.body", {
                  vertical: businessVertical ? t(`businessType.options.${businessVertical}`) : "",
                })}
              </p>
              <GoogleCalendarConnect />
            </div>
          )}

          {step === "invite" && (
            <div className="flex flex-col items-start gap-3">
              <Button type="button" variant="outline" onClick={() => setInviteOpen(true)}>
                {t("invite.cta")}
              </Button>
              <InviteMemberDialog
                open={inviteOpen}
                onOpenChange={setInviteOpen}
                onCreated={() => {}}
              />
            </div>
          )}

          {step === "done" && <FirstDiagnosisStep />}
        </CardContent>
        <CardFooter className="flex justify-between">
          {isFirst ? (
            <span />
          ) : (
            <Button type="button" variant="ghost" onClick={goBack} disabled={finishing}>
              {t("back")}
            </Button>
          )}
          <Button type="button" onClick={goNext} disabled={finishing}>
            {isLast ? t("finish") : t("next")}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
