// ============================================================
// /api/account/invitations/[id]
//
//   PATCH  — change a still-pending invite's role. Admin+.
//   DELETE — revoke a pending invitation by id.           Admin+.
//
// Both scoped to the caller's account via the
// `account_invitations_modify` RLS policy (`is_account_member
// (account_id, 'admin')`, migration 017) — no explicit
// `.eq('account_id', ...)` filter needed; a cross-account id just
// matches 0 rows.
//
// Why PATCH exists (and doesn't touch the token)
// ------------------------------------------------
// The invite link itself is only ever shown once (see the POST
// route's header comment) — an admin who already sent it to
// someone has no way to get it back except revoking (which kills
// the link the recipient may already have) and generating a brand
// new one. That's the wrong tool for "I picked the wrong role" or
// "actually make them a viewer, not an agent" — those just need
// the invite ROW updated, same token, same link, still works. This
// only touches still-pending invites (`accepted_at IS NULL`); once
// someone has redeemed it, the role lives on their `profiles` row
// instead and gets changed via PATCH /api/account/members/[userId].
// ============================================================

import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { isAccountRole } from "@/lib/auth/roles";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(
      `admin:inviteEdit:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;

    const body = (await request.json().catch(() => null)) as
      | { role?: unknown }
      | null;
    const role = body?.role;

    if (!isAccountRole(role) || role === "owner") {
      return NextResponse.json(
        { error: "'role' must be one of admin, agent, viewer" },
        { status: 400 },
      );
    }

    // Only a still-pending invite can be edited — one already
    // redeemed has moved its role onto the member's profile row,
    // and one already expired shouldn't be resurrected by an edit.
    const { data, error, count } = await ctx.supabase
      .from("account_invitations")
      .update({ role }, { count: "exact" })
      .eq("id", id)
      .is("accepted_at", null)
      .gt("expires_at", new Date().toISOString())
      .select("id, role, label, expires_at, created_at")
      .maybeSingle();

    if (error) {
      console.error("[PATCH /api/account/invitations/[id]] error:", error);
      return NextResponse.json(
        { error: "Failed to update invitation" },
        { status: 500 },
      );
    }

    if (count === 0 || !data) {
      // Either the id doesn't exist, belongs to another account (RLS
      // hides it), or it's no longer pending (already accepted /
      // expired) — 404 either way, same posture as DELETE below.
      return NextResponse.json(
        { error: "Invitation not found or no longer pending" },
        { status: 404 },
      );
    }

    return NextResponse.json({ invitation: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(
      `admin:inviteRevoke:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;

    // No `eq('account_id', ctx.accountId)` — the RLS policy
    // (`is_account_member(account_id, 'admin')`) already scopes
    // the DELETE to invites in the caller's account. Adding the
    // filter would be redundant; omitting it surfaces a
    // cross-account attempt as a silent 0-row delete (which is
    // exactly what we want for a revocation endpoint).
    const { error, count } = await ctx.supabase
      .from("account_invitations")
      .delete({ count: "exact" })
      .eq("id", id);

    if (error) {
      console.error("[DELETE /api/account/invitations/[id]] error:", error);
      return NextResponse.json(
        { error: "Failed to revoke invitation" },
        { status: 500 },
      );
    }

    if (count === 0) {
      // Either the id doesn't exist or RLS hid it (different
      // account). 404 either way — surfacing "exists but not
      // yours" would leak existence.
      return NextResponse.json(
        { error: "Invitation not found" },
        { status: 404 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
