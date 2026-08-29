"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { translateAuthError } from "@/lib/supabase/auth-errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CheckCircle } from "lucide-react";
import { AuthSplitShell, AUTH_ACCENT } from "@/components/auth/auth-split-shell";

// `useSearchParams` opts the component out of static prerendering
// unless wrapped in Suspense — same pattern as /login.
export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupPageInner />
    </Suspense>
  );
}

function SignupPageInner() {
  const t = useTranslations("SignupPage");
  const tErrors = useTranslations("AuthErrors");
  const searchParams = useSearchParams();
  // When the user lands here from `/join/<token>` we carry the
  // invite token in the query so it survives the signup → email
  // verification → redirect round-trip. `emailRedirectTo` below
  // points back at /join/<token> so the user lands on the redeem
  // step after verifying instead of being dropped on /dashboard.
  const inviteToken = searchParams.get("invite");

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const supabase = createClient();

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError(t("passwordMismatch"));
      return;
    }

    if (password.length < 6) {
      setError(t("passwordTooShort"));
      return;
    }

    setLoading(true);

    // If we have an invite token, point Supabase's verification
    // email back at the join page so the user can accept after
    // verifying. Without a token, Supabase uses its default
    // redirect (the app root).
    const emailRedirectTo = inviteToken
      ? `${window.location.origin}/join/${encodeURIComponent(inviteToken)}`
      : undefined;

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
        },
        ...(emailRedirectTo ? { emailRedirectTo } : {}),
      },
    });

    if (error) {
      setError(translateAuthError(error.message, tErrors));
      setLoading(false);
      return;
    }

    setSuccess(true);
    setLoading(false);
  };

  const heroHeadline = t.rich("heroHeadline", {
    highlight: (chunks) => <span style={{ color: AUTH_ACCENT }}>{chunks}</span>,
  });
  const heroTagline = t("heroTagline");

  if (success) {
    return (
      <AuthSplitShell headline={heroHeadline} tagline={heroTagline}>
        <div
          className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl"
          style={{ backgroundColor: "color-mix(in oklch, #D60000 15%, transparent)" }}
        >
          <CheckCircle className="h-6 w-6" style={{ color: AUTH_ACCENT }} />
        </div>
        <h2 className="font-heading text-2xl font-bold text-foreground">
          {t("checkEmailTitle")}
        </h2>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {t("checkEmailDesc", { email })}
        </p>
        <Link
          href={
            inviteToken
              ? `/login?invite=${encodeURIComponent(inviteToken)}`
              : "/login"
          }
        >
          <Button
            variant="outline"
            className="mt-6 w-full border-border text-foreground hover:bg-muted"
          >
            {t("backToSignIn")}
          </Button>
        </Link>
      </AuthSplitShell>
    );
  }

  return (
    <AuthSplitShell headline={heroHeadline} tagline={heroTagline}>
      <h2 className="font-heading text-2xl font-bold text-foreground">
        {inviteToken ? t("titleInvite") : t("title")}
      </h2>
      <p className="mt-1.5 text-sm text-muted-foreground">
        {inviteToken ? t("descInvite") : t("desc")}
      </p>

      <form onSubmit={handleSignup} className="mt-8 flex flex-col gap-4">
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
            htmlFor="fullName"
            className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase"
          >
            {t("fullNameLabel")}
          </Label>
          <Input
            id="fullName"
            type="text"
            placeholder={t("fullNamePlaceholder")}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
            className="h-11 border-border bg-[#12141C] text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label
            htmlFor="email"
            className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase"
          >
            {t("emailLabel")}
          </Label>
          <Input
            id="email"
            type="email"
            placeholder={t("emailPlaceholder")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="h-11 border-border bg-[#12141C] text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label
            htmlFor="password"
            className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase"
          >
            {t("passwordLabel")}
          </Label>
          <Input
            id="password"
            type="password"
            placeholder={t("passwordPlaceholder")}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="h-11 border-border bg-[#12141C] text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label
            htmlFor="confirmPassword"
            className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase"
          >
            {t("confirmPasswordLabel")}
          </Label>
          <Input
            id="confirmPassword"
            type="password"
            placeholder={t("confirmPasswordPlaceholder")}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            className="h-11 border-border bg-[#12141C] text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
          />
        </div>

        <Button
          type="submit"
          disabled={loading}
          className="mt-2 h-11 w-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {loading ? t("creatingAccount") : t("createAccount")}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        {t("haveAccount")}{" "}
        <Link
          href={
            inviteToken
              ? `/login?invite=${encodeURIComponent(inviteToken)}`
              : "/login"
          }
          className="font-semibold text-white hover:underline"
        >
          {t("signIn")}
        </Link>
      </p>
    </AuthSplitShell>
  );
}
