"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthSplitShell, AUTH_ACCENT } from "@/components/auth/auth-split-shell";
import { Loader2 } from "lucide-react";

// Only a same-origin path is a safe redirect target — a `next` value
// starting with `//` or containing a scheme would send the browser off
// this origin after MFA succeeds (open-redirect). proxy.ts only ever
// sets this to one of its own computed destinations, but validate
// again here since it arrives as an untrusted query string.
function safeNext(next: string | null): string {
  if (next && next.startsWith("/") && !next.startsWith("//")) return next;
  return "/dashboard";
}

// `useSearchParams` opts this component out of static prerendering
// unless it sits under a Suspense boundary — same pattern as /login.
export default function LoginMfaPage() {
  return (
    <Suspense fallback={null}>
      <LoginMfaPageInner />
    </Suspense>
  );
}

function LoginMfaPageInner() {
  const t = useTranslations("LoginMfaPage");
  const searchParams = useSearchParams();
  const next = safeNext(searchParams.get("next"));
  const supabase = createClient();

  const [factorId, setFactorId] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // proxy.ts already redirected here because this session's AAL
      // check said a step-up is pending, but re-derive the verified
      // factor directly rather than trusting the redirect blindly —
      // a user landing here with no pending step-up (e.g. a stale
      // bookmark, or 2FA got disabled in another tab) should just
      // continue on to `next` instead of being stuck on a code form
      // with nothing to submit it against.
      const { data, error: aalError } =
        await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (cancelled) return;

      if (aalError || !data || data.nextLevel !== "aal2" || data.currentLevel === data.nextLevel) {
        window.location.href = next;
        return;
      }

      const { data: factorsData } = await supabase.auth.mfa.listFactors();
      if (cancelled) return;

      const verifiedTotp = factorsData?.totp?.find((f) => f.status === "verified");
      if (!verifiedTotp) {
        // Assurance level said aal2 is reachable but no verified TOTP
        // factor turned up — inconsistent state, safest fallback is
        // to let them back into the normal flow rather than dead-end.
        window.location.href = next;
        return;
      }

      setFactorId(verifiedTotp.id);
      setChecking(false);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!factorId) return;
    setError(null);
    setVerifying(true);

    // Goes straight to Supabase (not through one of our own /api/auth/*
    // proxies) because GoTrue enforces its own per-factor lockout on
    // repeated failed MFA verification attempts server-side — unlike
    // password login/signup, there's no "anyone can hammer this with
    // the public anon key and our app never sees it" gap to close here.
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
      factorId,
      code: code.trim(),
    });

    if (verifyError) {
      setError(
        verifyError.code === "mfa_verification_failed"
          ? t("invalidCode")
          : verifyError.message,
      );
      setVerifying(false);
      return;
    }

    // Full-page navigation, same reasoning as /login: a fresh top-level
    // request is what carries the now-upgraded aal2 session cookies to
    // proxy.ts for the destination page.
    window.location.href = next;
  };

  return (
    <AuthSplitShell
      headline={<span style={{ color: AUTH_ACCENT }}>{t("title")}</span>}
      tagline={t("desc")}
    >
      <h2 className="font-heading text-2xl font-bold text-foreground">
        {t("title")}
      </h2>
      <p className="mt-1.5 text-sm text-muted-foreground">{t("desc")}</p>

      {checking ? (
        <div className="mt-8 flex justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <form onSubmit={handleVerify} className="mt-8 flex flex-col gap-4">
          {error && (
            <div
              role="alert"
              className="rounded-lg border px-4 py-3 text-sm"
              style={{
                borderColor: "color-mix(in oklch, #D60000 30%, transparent)",
                backgroundColor: "color-mix(in oklch, #D60000 10%, transparent)",
                color: "#FF6B6B",
              }}
            >
              {error}
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Label
              htmlFor="code"
              className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase"
            >
              {t("codeLabel")}
            </Label>
            <Input
              id="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder={t("codePlaceholder")}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              maxLength={10}
              required
              autoFocus
              className="h-11 border-border bg-[#12141C] text-center text-lg tracking-[0.3em] text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
            />
          </div>

          <Button
            type="submit"
            disabled={verifying || !code}
            className="mt-2 h-11 w-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {verifying ? t("verifying") : t("verify")}
          </Button>
        </form>
      )}
    </AuthSplitShell>
  );
}
