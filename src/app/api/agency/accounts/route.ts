// ============================================================
// POST /api/agency/accounts
//
// Create a brand-new client account from the /agency super-admin
// panel, plus a one-time owner-role invite link for its first user.
// Gated by requireSuperAdmin() — the same identity check as the
// /agency page itself and every other agency route.
//
// Account + invitation are created atomically by a single Postgres
// function (create_agency_account_with_owner_invite, migration 052):
// if the invitation insert fails for any reason, the account insert
// rolls back with it. There is no intermediate state where an
// account exists without its invite, or vice versa.
// ============================================================

import { NextResponse } from "next/server";

import { requireSuperAdmin } from "@/lib/auth/agency";
import { supabaseAdmin } from "@/lib/agency/admin-client";
import {
  clampExpiryDays,
  generateInviteToken,
  getBaseUrl,
  inviteExpiresAt,
  inviteUrl,
} from "@/lib/auth/invitations";
import { ForbiddenError, UnauthorizedError } from "@/lib/auth/account";

const MAX_NAME_LEN = 120;
const MAX_LABEL_LEN = 80;
const CURRENCY_RE = /^[A-Z]{3}$/;

export async function POST(request: Request) {
  let superAdminId: string;
  try {
    ({ userId: superAdminId } = await requireSuperAdmin());
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (err instanceof ForbiddenError) {
      // Mirrors the page's own posture: don't confirm this route
      // exists to a non-super-admin caller.
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as
    | { name?: unknown; ownerEmail?: unknown; defaultCurrency?: unknown }
    | null;

  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json(
      { error: "Business name is required" },
      { status: 400 },
    );
  }
  if (name.length > MAX_NAME_LEN) {
    return NextResponse.json(
      { error: `Business name must be ${MAX_NAME_LEN} characters or fewer` },
      { status: 400 },
    );
  }

  const ownerEmail =
    typeof body?.ownerEmail === "string" ? body.ownerEmail.trim() : "";
  if (!ownerEmail) {
    return NextResponse.json(
      { error: "Owner email is required" },
      { status: 400 },
    );
  }
  if (ownerEmail.length > MAX_LABEL_LEN) {
    return NextResponse.json(
      { error: `Owner email must be ${MAX_LABEL_LEN} characters or fewer` },
      { status: 400 },
    );
  }

  let defaultCurrency = "USD";
  if (typeof body?.defaultCurrency === "string" && body.defaultCurrency.trim()) {
    const raw = body.defaultCurrency.trim().toUpperCase();
    if (!CURRENCY_RE.test(raw)) {
      return NextResponse.json(
        { error: "defaultCurrency must be a 3-letter ISO code" },
        { status: 400 },
      );
    }
    defaultCurrency = raw;
  }

  const expiryDays = clampExpiryDays(undefined); // default expiry, same as member invites
  const expiresAt = inviteExpiresAt(expiryDays);
  const { token, hash } = generateInviteToken();

  const db = supabaseAdmin();
  const { data: accountId, error } = await db.rpc(
    "create_agency_account_with_owner_invite",
    {
      p_name: name,
      p_default_currency: defaultCurrency,
      p_agency_owner_user_id: superAdminId,
      p_token_hash: hash,
      p_label: ownerEmail,
      p_expires_at: expiresAt.toISOString(),
    },
  );

  if (error || !accountId) {
    console.error("[POST /api/agency/accounts] create error:", error);
    return NextResponse.json(
      { error: "Failed to create account" },
      { status: 500 },
    );
  }

  return NextResponse.json(
    {
      accountId,
      // Plaintext payload — visible to the agency owner exactly once.
      url: inviteUrl(token, getBaseUrl(request, "POST /api/agency/accounts")),
      expiresInDays: expiryDays,
    },
    { status: 201 },
  );
}
