"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CheckCircle2 } from "lucide-react";
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
import { AiConfig } from "@/components/settings/ai-config";
import { GoogleCalendarConnect } from "@/components/settings/google-calendar-connect";
import { InviteMemberDialog } from "@/components/settings/invite-member-dialog";
import { BusinessTypeStep } from "./business-type-step";
import { useAuth } from "@/hooks/use-auth";
import { APPOINTMENT_BASED_VERTICALS, type BusinessVertical } from "@/types";

// Order matters — business type first (decides whether "calendar"
// below is shown at all), then WhatsApp because nothing else in the
// product works without it (inbox/broadcasts/AI auto-reply are all
// inert with no channel connected). The rest are informational/optional.
const BASE_STEP_KEYS = ["businessType", "whatsapp", "pipeline", "ai"] as const;
const TAIL_STEP_KEYS = ["invite", "done"] as const;
type StepKey =
  | (typeof BASE_STEP_KEYS)[number]
  | "calendar"
  | (typeof TAIL_STEP_KEYS)[number];

export function OnboardingWizard() {
  const t = useTranslations("Onboarding");
  const router = useRouter();
  const { account } = useAuth();
  const [stepIndex, setStepIndex] = useState(0);
  const [finishing, setFinishing] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [businessVertical, setBusinessVertical] = useState<BusinessVertical | null>(
    account?.business_vertical ?? null,
  );

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

  // Marks the account onboarded and leaves the wizard — used by both
  // "Skip setup" (from any step) and the final step's "Finish" button.
  // Best-effort: even if the request fails, don't trap the user here —
  // they'll just see the wizard again next login, which is safe (the
  // column stays NULL, nothing else depends on it).
  const complete = async () => {
    setFinishing(true);
    try {
      await fetch("/api/onboarding/complete", { method: "POST" });
    } finally {
      router.push("/dashboard");
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
            <BusinessTypeStep value={businessVertical} onChange={handleSelectVertical} />
          )}

          {step === "whatsapp" && <WhatsAppChannelOptions />}

          {step === "pipeline" && (
            <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm">
              <p className="font-medium text-foreground">{t("pipeline.stagesLabel")}</p>
              <p className="mt-1 text-muted-foreground">
                New Lead → Qualified → Proposal Sent → Negotiation → Won
              </p>
            </div>
          )}

          {step === "ai" && <AiConfig />}

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

          {step === "done" && (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <CheckCircle2 className="h-12 w-12 text-primary" />
              <p className="text-muted-foreground">{t("done.body")}</p>
            </div>
          )}
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
