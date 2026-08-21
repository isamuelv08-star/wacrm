import { createClient } from "@/lib/supabase/server";
import { UnauthorizedError, ForbiddenError } from "./account";

// ============================================================
// Super-admin identity check for the agency owner's cross-account
// panel (/agency). Deliberately NOT part of the account_role system
// in ./roles.ts — this has nothing to do with membership in any one
// account; it's a single hardcoded identity, checked server-side,
// independent of which (if any) account the caller happens to belong
// to.
//
// Why an env var instead of a `profiles` column or a JWT claim:
//   - Zero new database surface — nothing else to secure with RLS.
//   - Can't be flipped by an application bug (a column could
//     theoretically be touched by account-transfer/invite code by
//     accident; an env var only changes at deploy time).
//   - One choke point (`requireSuperAdmin`) — trivial to swap for a
//     real table later without touching any caller.
//
// The actual data-isolation guarantee still comes from RLS
// (is_account_member, migration 017) for every other route in the
// app. This function gates the ONE place that intentionally bypasses
// it via the service-role client (src/lib/agency/admin-client.ts).
// ============================================================

/**
 * Throws `UnauthorizedError` when there's no session, `ForbiddenError`
 * when the signed-in user isn't the configured super admin. Callers
 * (the /agency page) should catch both and respond with `notFound()`
 * — a generic 404 rather than a "not allowed" page, so a non-admin
 * probing the URL gets no confirmation the route even exists.
 */
export async function requireSuperAdmin(): Promise<{ userId: string }> {
  const superAdminId = process.env.SUPER_ADMIN_USER_ID;
  if (!superAdminId) {
    // Not configured — treat as "nobody is super admin" rather than
    // silently allowing everyone through on a misconfigured deploy.
    throw new ForbiddenError("Agency panel is not configured");
  }

  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) {
    throw new UnauthorizedError();
  }
  if (user.id !== superAdminId) {
    throw new ForbiddenError();
  }

  return { userId: user.id };
}
