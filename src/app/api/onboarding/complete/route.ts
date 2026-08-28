import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";

// Marks the caller's account as having finished (or explicitly
// skipped) the first-run onboarding wizard — see migration 063.
// `admin` matches the RLS policy on `accounts` UPDATE (migration 017);
// in practice this is called by whoever is going through the wizard,
// almost always the owner who just created the account.
export async function POST() {
  try {
    const ctx = await requireRole("admin");

    const { error } = await ctx.supabase
      .from("accounts")
      .update({ onboarding_completed_at: new Date().toISOString() })
      .eq("id", ctx.accountId);

    if (error) {
      console.error("[POST /api/onboarding/complete] update error:", error);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
