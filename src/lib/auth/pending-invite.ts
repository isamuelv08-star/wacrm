// ============================================================
// pending-invite — remembers "this browser is in the middle of
// accepting an invite" across the signup/email-verification round
// trip, purely client-side (localStorage).
//
// Why this exists
// ----------------
// `/join/<token>` is supposed to be the ONLY place a freshly
// invited teammate ever lands: sign up (or log in) → redirect back
// to `/join/<token>` → accept → their brand-new personal account is
// deleted and swapped for the inviter's. If that redirect chain
// breaks for any reason (Supabase's email-confirmation redirect
// isn't on the project's allow-list, the user opens the
// verification link in a different tab, a race between the auth
// state listener and the route guard, ...), the visitor lands on
// `/dashboard` with a fresh, un-onboarded personal account instead
// — and `DashboardShell` sends them straight into the full
// "set up your business from scratch" wizard. From their side that
// looks exactly like the invite link didn't work at all.
//
// Saving the token here as soon as `/join/<token>` is visited gives
// `DashboardShell` (and `OnboardingShell`, belt-and-braces) a way to
// notice "this account isn't onboarded AND there's a pending invite
// for this browser" and route back to `/join/<token>` to finish
// accepting instead of starting onboarding on the doomed personal
// account.
// ============================================================

const PENDING_INVITE_KEY = "saleslid_pending_invite_token";

function safeLocalStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    // Private-browsing / storage-blocked contexts can throw just from
    // touching `window.localStorage`. Degrade to "no pending invite
    // tracking" rather than crashing the join page.
    return null;
  }
}

/** Call when `/join/<token>` mounts (or peek confirms the token is
 *  still valid) so the token survives navigation away from the page. */
export function savePendingInviteToken(token: string): void {
  safeLocalStorage()?.setItem(PENDING_INVITE_KEY, token);
}

/** Read without clearing — used where a caller wants to check the
 *  presence of a pending invite without consuming it. */
export function getPendingInviteToken(): string | null {
  return safeLocalStorage()?.getItem(PENDING_INVITE_KEY) ?? null;
}

/** Call once the token is no longer useful: redeemed successfully,
 *  or the peek came back terminally invalid (not_found/used/expired). */
export function clearPendingInviteToken(): void {
  safeLocalStorage()?.removeItem(PENDING_INVITE_KEY);
}

/**
 * Read-and-clear in one step. `DashboardShell`'s onboarding gate uses
 * this so the auto-redirect to `/join/<token>` only ever fires once
 * per saved token — if accepting it fails (expired, already used,
 * conflict with an existing account), the next visit to `/dashboard`
 * falls through to the normal onboarding wizard instead of looping.
 */
export function consumePendingInviteToken(): string | null {
  const token = getPendingInviteToken();
  if (token) clearPendingInviteToken();
  return token;
}
