import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { ensureDefaultPipeline } from "@/lib/pipelines/default-stages";

// Marks the caller's account as having finished (or explicitly
// skipped) the first-run onboarding wizard — see migration 063.
// `admin` matches the RLS policy on `accounts` UPDATE (migration 017);
// in practice this is called by whoever is going through the wizard,
// almost always the owner who just created the account.
export async function POST() {
  try {
    const ctx = await requireRole("admin");

    // Guaranteed fallback for the onboarding audit's #1 critical
    // finding: the wizard's pipeline step (onboarding-wizard.tsx)
    // already calls ensureDefaultPipeline itself when reached, but
    // "Saltar configuración" can fire this endpoint from an earlier
    // step, before that step ever ran. Idempotent — a no-op if a
    // pipeline already exists — so this closes that gap without
    // double-creating anything for the normal path.
    await ensureDefaultPipeline(ctx.supabase, ctx.accountId, ctx.userId);

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
