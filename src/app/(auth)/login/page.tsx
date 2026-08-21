"use client";

import { Suspense, useState, type CSSProperties } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UsersRound } from "lucide-react";
import { ScalingSignaturePanel } from "@/components/auth/scaling-signature-panel";

// Scoped light-panel palette (Porcelain/Ink/Scaling Red — see the
// approved design plan). Plain inline custom properties, NOT
// `<style jsx>`: verified via a raw SSR fetch that styled-jsx's
// scoping class lands on every element in this Next.js version but
// its `<style>` tag does not ship in the initial HTML — only its
// client-side runtime would apply the rules, which means a real FOUC
// (unstyled flash) on a page whose entire point is looking right
// immediately. Inline style always renders synchronously in SSR'd
// HTML; Button/Input/Label still resolve these normally since
// they're just CSS custom properties consumed via existing Tailwind
// classes (bg-primary, text-foreground, border-border, ...) — no
// changes needed to those shared components.
//
// `--primary` is #D60000, NOT the pure brand swatch #FF3131: measured
// contrast (WCAG relative-luminance formula) puts white-on-#FF3131 at
// 3.66:1 and #FF3131-on-Porcelain at 3.45:1 — both fail the 4.5:1 text
// minimum (they'd only clear the 3:1 large-text/non-text-UI bar). This
// darker step of the same hue (H0/S100, L46%→42%) clears text contrast
// comfortably (5.1–5.4:1) everywhere --primary drives text or a
// text-bearing button fill. The true #FF3131 swatch is kept for
// purely decorative, non-text use (the signature panel's bars, the
// logo mark image) where the more lenient 3:1 threshold already
// applies and the fully-saturated brand color should show through.
const loginFormPanelStyle = {
  "--background": "#faf8f5",
  "--card": "#faf8f5",
  "--foreground": "#12182a",
  "--muted-foreground": "#6b7280",
  "--primary": "#d60000",
  "--primary-foreground": "#faf8f5",
  "--ring": "#d60000",
  "--border": "#e6e1d9",
  "--input": "#e6e1d9",
  "--muted": "#f1ede6",
  backgroundColor: "var(--background)",
  color: "var(--foreground)",
} as CSSProperties;

// `useSearchParams` opts the component out of static prerendering
// unless it sits under a Suspense boundary. We split the form into
// a child component so the outer page can prerender the chrome
// (background, card frame) while the form hydrates with the query
// string on the client.
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageInner />
    </Suspense>
  );
}

function LoginPageInner() {
  const searchParams = useSearchParams();
  // Forwarded from `/join/<token>` when the visitor already has an
  // account. After a successful sign-in we send them to the join
  // page to accept rather than to /dashboard.
  const inviteToken = searchParams.get("invite");
  const t = useTranslations("LoginPage");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const supabase = createClient();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    // Full-page navigation (not router.push) so the browser issues a
    // fresh top-level request that carries the just-written Supabase
    // auth cookies to the middleware gating /dashboard. A soft
    // client-side navigation can reach the protected route before the
    // server observes the new session, so the middleware bounces it
    // back to /login — which looks like the page "just refreshing"
    // instead of signing in (issue #365). Mirrors the deliberate full
    // reload the invite-accept flow already uses in join/[token].
    const destination = inviteToken
      ? `/join/${encodeURIComponent(inviteToken)}`
      : "/dashboard";
    window.location.href = destination;
  };

  return (
    // Abyss Navy exterior frame — deliberately NOT tied to the app's
    // saved theme/mode (a not-yet-authenticated visitor has no
    // personalization to respect here), so these are plain literal
    // brand hex values rather than the shared --background token. See
    // the approved design plan for the full palette + rationale.
    <div
      className="flex min-h-screen items-center justify-center p-4 lg:p-8"
      style={{ backgroundColor: "#0A1120" }}
    >
      <div className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-500 relative flex w-full max-w-5xl flex-col overflow-hidden rounded-3xl shadow-2xl shadow-black/40 lg:min-h-[640px] lg:flex-row">
        {/* Mobile-only brand strip — the signature panel is dropped
            entirely below lg (it's decorative; a phone screen is for
            the form), but this keeps the mark visible so identity
            isn't lost. */}
        <div
          className="flex shrink-0 items-center gap-2 px-6 py-5 lg:hidden"
          style={{ backgroundColor: "#0A1120" }}
        >
          <img
            src="/scaling-logo-mark.png"
            alt=""
            className="h-6 w-6 object-contain"
          />
          <span className="font-heading text-sm font-semibold tracking-wide text-white">
            ScalingCRM
          </span>
        </div>

        {/* Form panel — scoped light palette (Porcelain/Ink/Scaling
            Red) via CSS custom properties, so the existing Button/
            Input/Label components (which already consume --primary,
            --ring, --border, etc.) pick up the new colors with zero
            changes to those shared components. */}
        <div
          className="flex w-full flex-col justify-center px-6 py-10 sm:px-10 lg:w-[46%] lg:px-14 lg:py-14"
          style={loginFormPanelStyle}
        >
          <div className="mx-auto w-full max-w-sm">
            <div className="mb-8 hidden items-center gap-2 lg:flex">
              {inviteToken ? (
                <span
                  className="flex h-10 w-10 items-center justify-center rounded-xl"
                  style={{ backgroundColor: "color-mix(in oklch, #D60000 12%, transparent)" }}
                >
                  <UsersRound className="h-5 w-5" style={{ color: "#D60000" }} />
                </span>
              ) : (
                <img
                  src="/scaling-logo-mark.png"
                  alt=""
                  className="h-8 w-8 object-contain"
                />
              )}
            </div>

            <h1 className="font-heading text-2xl font-semibold text-foreground">
              {inviteToken ? t("titleAccept") : t("titleWelcome")}
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {inviteToken ? t("descAccept") : t("descWelcome")}
            </p>

            <form onSubmit={handleLogin} className="mt-8 flex flex-col gap-4">
              {error && (
                <div
                  role="alert"
                  className="rounded-lg border px-4 py-3 text-sm"
                  style={{
                    borderColor: "color-mix(in oklch, #D60000 30%, transparent)",
                    backgroundColor: "color-mix(in oklch, #D60000 8%, transparent)",
                    color: "#C81E1E",
                  }}
                >
                  {error}
                </div>
              )}

              <div className="flex flex-col gap-2">
                <Label htmlFor="email" className="text-muted-foreground">
                  {t("emailLabel")}
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder={t("emailPlaceholder")}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="h-11 border-border bg-white text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
                />
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password" className="text-muted-foreground">
                    {t("passwordLabel")}
                  </Label>
                  <Link
                    href="/forgot-password"
                    className="text-sm font-medium text-primary hover:text-primary/80"
                  >
                    {t("forgotPassword")}
                  </Link>
                </div>
                <Input
                  id="password"
                  type="password"
                  placeholder={t("passwordPlaceholder")}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="h-11 border-border bg-white text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
                />
              </div>

              <Button
                type="submit"
                disabled={loading}
                className="mt-2 h-11 w-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {loading ? t("signingIn") : t("signIn")}
              </Button>
            </form>

            <p className="mt-6 text-center text-sm text-muted-foreground">
              {t("noAccount")}{" "}
              <Link
                href={
                  inviteToken
                    ? `/signup?invite=${encodeURIComponent(inviteToken)}`
                    : "/signup"
                }
                className="font-medium text-primary hover:text-primary/80"
              >
                {t("createAccount")}
              </Link>
            </p>
          </div>
        </div>

        {/* Signature panel — desktop only, see ScalingSignaturePanel's
            own doc comment for the design rationale. */}
        <div className="hidden lg:block lg:w-[54%]">
          <ScalingSignaturePanel />
        </div>
      </div>
    </div>
  );
}
