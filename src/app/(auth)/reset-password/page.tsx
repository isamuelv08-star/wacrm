"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { translateAuthError } from "@/lib/supabase/auth-errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CheckCircle, KeyRound, Loader2, TriangleAlert } from "lucide-react";

const MIN_PASSWORD = 8;

// By the time a visitor lands here, /auth/callback has already
// exchanged the recovery `code` for a real session — that's the only
// way GoTrue lets `updateUser({ password })` succeed. A direct visit
// (no code, expired link, link already used) has no session, so we
// check for one on mount instead of assuming the form can be shown.
type SessionState = "checking" | "ready" | "missing";

export default function ResetPasswordPage() {
  const t = useTranslations("ResetPasswordPage");
  const tErrors = useTranslations("AuthErrors");
  const supabase = createClient();

  const [sessionState, setSessionState] = useState<SessionState>("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setSessionState(user ? "ready" : "missing");
    });
  }, [supabase]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < MIN_PASSWORD) {
      setError(t("tooShort", { min: MIN_PASSWORD }));
      return;
    }
    if (password !== confirm) {
      setError(t("mismatch"));
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setError(translateAuthError(error.message, tErrors));
      setLoading(false);
      return;
    }

    setSuccess(true);
    setLoading(false);
  };

  let body: React.ReactNode;

  if (sessionState === "checking") {
    body = (
      <div className="flex justify-center py-6">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  } else if (sessionState === "missing") {
    body = (
      <CardContent>
        <div className="flex flex-col items-center gap-2 text-center">
          <TriangleAlert className="h-8 w-8 text-amber-500" />
          <p className="text-sm text-muted-foreground">{t("invalidLinkDesc")}</p>
        </div>
        <Link href="/forgot-password">
          <Button className="mt-6 w-full bg-primary text-primary-foreground hover:bg-primary/90">
            {t("requestNewLink")}
          </Button>
        </Link>
      </CardContent>
    );
  } else if (success) {
    body = (
      <CardContent>
        <div className="flex flex-col items-center gap-2 text-center">
          <CheckCircle className="h-8 w-8 text-primary" />
          <p className="text-sm text-muted-foreground">{t("successDesc")}</p>
        </div>
        <Link href="/login">
          <Button className="mt-6 w-full bg-primary text-primary-foreground hover:bg-primary/90">
            {t("backToSignIn")}
          </Button>
        </Link>
      </CardContent>
    );
  } else {
    body = (
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {error && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
              {error}
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="password" className="text-muted-foreground">
              {t("newPasswordLabel")}
            </Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              minLength={MIN_PASSWORD}
              required
              className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="confirm" className="text-muted-foreground">
              {t("confirmPasswordLabel")}
            </Label>
            <Input
              id="confirm"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              minLength={MIN_PASSWORD}
              required
              className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
            />
          </div>

          <Button
            type="submit"
            disabled={loading}
            className="mt-2 h-10 w-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {loading ? t("submitting") : t("submit")}
          </Button>
        </form>
      </CardContent>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md border-border bg-card">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
            <KeyRound className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-xl text-foreground">{t("title")}</CardTitle>
          <CardDescription className="text-muted-foreground">
            {t("desc")}
          </CardDescription>
        </CardHeader>
        {body}
      </Card>
    </div>
  );
}
