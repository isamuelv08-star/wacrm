"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

/** Google's official 4-color "G" mark — no icon library ships this,
 *  so it's a small inline SVG rather than a dependency. */
function GoogleGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
      <path
        fill="#4285F4"
        d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.47a5.54 5.54 0 0 1-2.4 3.64v3h3.88c2.27-2.09 3.57-5.17 3.57-8.83z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.07 7.95-2.9l-3.88-3c-1.08.72-2.46 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.27v3.11A12 12 0 0 0 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.29a7.2 7.2 0 0 1 0-4.58V6.6H1.27a12 12 0 0 0 0 10.8z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.76 0 3.34.6 4.59 1.79l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.27 6.6l4 3.11C6.22 6.86 8.87 4.75 12 4.75z"
      />
    </svg>
  );
}

interface GoogleAuthButtonProps {
  /** Button label, already translated by the caller. */
  label: string;
  /** Where the browser should land after the OAuth round trip
   *  finishes (see /auth/callback's `next` param). */
  next?: string;
}

/**
 * "Continue with Google" — Supabase's native OAuth provider, purely
 * for signing in/up. Independent of the separate Google Calendar
 * connection (Settings → Integrations): this button never requests
 * Calendar scopes and Supabase doesn't durably store the resulting
 * provider token, so it can't be reused for calendar access anyway —
 * see the header note in src/lib/google-calendar/oauth.ts's connect
 * flow for that one.
 */
export function GoogleAuthButton({ label, next }: GoogleAuthButtonProps) {
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setLoading(true);
    const supabase = createClient();
    const redirectTo = new URL("/auth/callback", window.location.origin);
    if (next) redirectTo.searchParams.set("next", next);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: redirectTo.toString() },
    });
    if (error) {
      // Supabase redirects the browser away on success — an error here
      // means the request itself failed (e.g. the provider isn't
      // enabled on this project), so just stop spinning and let the
      // user retry or fall back to email/password.
      console.error("[GoogleAuthButton] signInWithOAuth failed:", error.message);
      setLoading(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      onClick={handleClick}
      disabled={loading}
      className="h-11 w-full gap-2 border-border bg-[#12141C] text-foreground hover:bg-muted"
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <GoogleGlyph />}
      {label}
    </Button>
  );
}
