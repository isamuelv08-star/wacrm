// ============================================================
// Server-side account context — for API routes and server
// components. Reads the caller's profile + account in one round
// trip and verifies role on demand.
//
// IMPORTANT: this module is server-only. It imports the Supabase
// SSR client (`@/lib/supabase/server`), which reads `next/headers`
// cookies. Importing it from a client component will fail at
// build time with the standard Next.js "You're importing a
// component that needs `next/headers`" error — that's the
// boundary check; we don't need the `server-only` package.
//
// Calling convention
// ------------------
// API routes don't need to redo `supabase.auth.getUser()` — they
// receive a fully-loaded context from `requireRole`:
//
//   try {
//     const ctx = await requireRole("admin");
//     // ctx.supabase — the SSR client (RLS scoped to this user)
//     // ctx.userId  — auth.uid()
//     // ctx.accountId / ctx.role / ctx.account
//   } catch (err) {
//     return errorResponse(err); // see toErrorResponse() below
//   }
// ============================================================

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { hasMinRole, isAccountRole, type AccountRole } from "./roles";
import type { BusinessVertical } from "@/types";

// ------------------------------------------------------------
// Errors
//
// Custom classes so API routes can map a single `catch` to the
// right HTTP status without sprinkling 401/403 strings everywhere.
// ------------------------------------------------------------

export class UnauthorizedError extends Error {
  readonly status = 401 as const;
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  readonly status = 403 as const;
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/**
 * Convert one of the typed errors above (or anything else) into a
 * `NextResponse`. Routes can do:
 *
 *   } catch (err) {
 *     return toErrorResponse(err);
 *   }
 *
 * Unknown errors collapse to 500 with the generic message — we
 * never leak `err.message` for non-classified errors to keep
 * server internals out of the wire.
 */
export function toErrorResponse(err: unknown): NextResponse {
  if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error("[toErrorResponse] uncategorized error:", err);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

// ------------------------------------------------------------
// Account context
// ------------------------------------------------------------

export interface AccountContext {
  /** Supabase SSR client, RLS scoped to the calling user. */
  supabase: SupabaseClient;
  /** `auth.uid()` for the caller. Always defined when this resolves. */
  userId: string;
  /** Caller's account_id from their profile row. */
  accountId: string;
  /** Caller's role within their account. */
  role: AccountRole;
  /** Lightweight account meta — id, name, and the HOT-lead alert threshold. */
  account: {
    id: string;
    name: string;
    hot_lead_alert_minutes: number;
    /** Hours a deal can sit unanswered by the customer before the
     *  followup-stage cron moves it into is_followup_stage (migration
     *  078). 0 disables the feature for this account. */
    followup_after_hours: number;
    timezone: string;
    business_vertical: BusinessVertical | null;
    whatsapp_mode: 'shared' | 'multiwhatsapp';
    /** 'active' (default) | 'pending' | 'suspended' (migration 088). */
    status: 'pending' | 'active' | 'suspended';
  };
}

/**
 * Resolve the caller's user + account + role in one round trip.
 *
 * Throws `UnauthorizedError` if there's no Supabase session.
 * Throws `ForbiddenError` if the profile is missing account
 * fields (shouldn't happen post-017 migration; defensive guard
 * against profile rows that pre-date the backfill or were
 * inserted by hand).
 *
 * Use `requireRole(min)` instead when the route also needs a
 * minimum-role check — it's a thin wrapper over this.
 */
export async function getCurrentAccount(): Promise<AccountContext> {
  const supabase = await createClient();

  // supabase-js's getUser() THROWS (rather than returning
  // { user: null, error }) when the access token is expired and the
  // refresh token it tries to use turns out invalid/missing — e.g. a
  // stale cookie from before a token rotation, or a Supabase project
  // reset. Left unguarded, that exception propagates out of this
  // function and crashes whatever called it instead of just meaning
  // "not signed in", which is what should happen here. See the
  // matching fix in src/proxy.ts and src/lib/auth/agency.ts.
  let user: Awaited<ReturnType<typeof supabase.auth.getUser>>["data"]["user"] = null;
  try {
    const result = await supabase.auth.getUser();
    if (result.error) throw result.error;
    user = result.data.user;
  } catch (err) {
    console.error("[getCurrentAccount] auth.getUser() failed:", err);
  }
  if (!user) {
    throw new UnauthorizedError();
  }

  // MFA step-up gate. getAuthenticatorAssuranceLevel() reads the
  // already-loaded session (decodes the access token's `aal` claim
  // and checks the user's verified factors) — no extra network round
  // trip. A user with a verified TOTP factor whose session hasn't
  // completed that second factor yet (nextLevel is 'aal2' but
  // currentLevel is still 'aal1') is treated exactly like "not signed
  // in": this is the actual enforcement point for all ~85 routes that
  // go through requireRole()/getCurrentAccount(), same reasoning as
  // the restricted-access gate below — proxy.ts's redirect to
  // /login-mfa is UX only, not the security boundary.
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal && aal.nextLevel === "aal2" && aal.currentLevel !== aal.nextLevel) {
    throw new UnauthorizedError("MFA verification required");
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("account_id, account_role")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("[getCurrentAccount] profile fetch error:", error);
    throw new ForbiddenError("Could not load account context");
  }
  if (!data || !data.account_id || !data.account_role) {
    // Pre-migration profile, or a manual insert that skipped the
    // signup trigger. The user is authenticated but the app has
    // no way to scope their queries — treat as forbidden.
    throw new ForbiddenError("Profile is not linked to an account");
  }
  if (!isAccountRole(data.account_role)) {
    // The DB enum should make this impossible, but a future
    // migration that broadens the enum without updating TS would
    // hit this — surface it rather than silently widening.
    throw new ForbiddenError(`Unknown account role: ${data.account_role}`);
  }

  // Load the account with a plain point lookup by id rather than an
  // embedded FK join (`account:accounts!inner(...)`). The embed forces
  // PostgREST to resolve the profiles.account_id → accounts.id
  // relationship from its schema cache; when that cache is stale — a
  // common Supabase state right after a migration adds the FK, or when
  // migrations are applied out of band — the embed fails hard with
  // PGRST200 ("could not find a relationship … in the schema cache")
  // and takes down the entire account context (issue #294). A lookup by
  // id needs no relationship inference and is gated by the same accounts
  // RLS, so it stays robust against cache staleness and older schemas.
  const { data: account, error: accountErr } = await supabase
    .from("accounts")
    .select("id, name, hot_lead_alert_minutes, followup_after_hours, timezone, business_vertical, whatsapp_mode, status")
    .eq("id", data.account_id)
    .maybeSingle();

  if (accountErr) {
    console.error("[getCurrentAccount] account fetch error:", accountErr);
    throw new ForbiddenError("Could not load account context");
  }
  if (!account) {
    // account_id points at no readable account row — orphaned profile
    // or an RLS gap. Same "can't scope this user" outcome as above.
    throw new ForbiddenError("Profile is not linked to an account");
  }

  // Same missing-column fallback as every other optional field below
  // (whatsapp_mode, business_vertical, ...) — a row/mock that doesn't
  // carry `status` (older schema-cache snapshot, or a test double)
  // reads as 'active', matching the DB column's own DEFAULT rather
  // than tripping the restricted-access gate below on absence alone.
  const accountStatus = (account.status as "pending" | "active" | "suspended" | null) ?? "active";

  // Restricted-access gate (migration 088) — enforced here, not just
  // in DashboardShell's client-side redirect. Without this, a
  // 'pending' (self-signed-up, not yet approved) or 'suspended'
  // account's own valid session cookie could still call every API
  // route directly (curl/Postman, or simply beating the browser's
  // useEffect redirect), completely bypassing the "only the agency
  // owner grants access" feature — the redirect alone is UX, not
  // access control. This is the actual enforcement point for all
  // ~85 routes that go through requireRole()/getCurrentAccount().
  if (accountStatus !== "active") {
    throw new ForbiddenError("Account access is restricted");
  }

  return {
    supabase,
    userId: user.id,
    accountId: data.account_id,
    role: data.account_role,
    account: {
      id: account.id,
      name: account.name,
      hot_lead_alert_minutes: account.hot_lead_alert_minutes,
      followup_after_hours: account.followup_after_hours,
      timezone: account.timezone,
      business_vertical: (account.business_vertical as BusinessVertical | null) ?? null,
      whatsapp_mode: (account.whatsapp_mode as 'shared' | 'multiwhatsapp' | null) ?? 'shared',
      status: accountStatus,
    },
  };
}

/**
 * Resolve the caller's account context and enforce a minimum role.
 *
 * Throws `UnauthorizedError` / `ForbiddenError` as documented on
 * `getCurrentAccount`, plus `ForbiddenError("Insufficient role")`
 * when the caller is below `min`.
 */
export async function requireRole(min: AccountRole): Promise<AccountContext> {
  const ctx = await getCurrentAccount();
  if (!hasMinRole(ctx.role, min)) {
    throw new ForbiddenError(
      `This action requires the '${min}' role or higher`,
    );
  }
  return ctx;
}
