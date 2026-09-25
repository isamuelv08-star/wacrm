import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/ai/admin-client";
import { logAiActivity } from "@/lib/ai/activity-log";

/**
 * PATCH /api/deals/[id]/stage  (agent+, matches deals_update RLS)
 *
 * Moves a deal to a different stage of its OWN pipeline, and — unlike
 * a plain client-side `deals` update — logs it to `ai_activity_events`
 * (migration 109) so the change shows up inline in the Inbox thread as
 * "Ventas 1 movió este lead a Calificado", the same way the AI's own
 * stage moves already do. That write needs the service-role client
 * (ai_activity_events has no INSERT policy for `authenticated`, by
 * design — see migration 075), which only server code can reach, so
 * this route exists instead of the browser updating `deals` directly
 * the way most of this app's simpler edits do.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("agent");
    const { id: dealId } = await params;

    const body = await request.json().catch(() => null);
    const stageId = typeof body?.stage_id === "string" ? body.stage_id : null;
    if (!stageId) {
      return NextResponse.json({ error: "stage_id is required" }, { status: 400 });
    }

    // RLS (deals_select) already scopes this to the caller's account.
    const { data: deal, error: dealErr } = await ctx.supabase
      .from("deals")
      .select("id, pipeline_id, stage_id, contact_id, conversation_id")
      .eq("id", dealId)
      .maybeSingle();
    if (dealErr || !deal) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }

    // The target stage must belong to the SAME pipeline as the deal —
    // otherwise a crafted request could point a deal at an unrelated
    // pipeline's stage id.
    const { data: stage, error: stageErr } = await ctx.supabase
      .from("pipeline_stages")
      .select("id, name, color")
      .eq("id", stageId)
      .eq("pipeline_id", deal.pipeline_id)
      .maybeSingle();
    if (stageErr || !stage) {
      return NextResponse.json({ error: "Stage not found on this deal's pipeline" }, { status: 400 });
    }

    const stagePayload = { id: stage.id, name: stage.name, color: stage.color };
    // Re-selecting the same stage is a no-op — no write, no "moved this
    // lead to X" entry in the thread.
    if (deal.stage_id === stageId) {
      return NextResponse.json({ ok: true, stage: stagePayload });
    }

    const { data: updated, error: updateErr } = await ctx.supabase
      .from("deals")
      .update({ stage_id: stageId })
      .eq("id", dealId)
      .select("id");
    if (updateErr) {
      console.error("[PATCH /api/deals/[id]/stage] update error:", updateErr.message);
      return NextResponse.json({ error: "Failed to update stage" }, { status: 500 });
    }
    // RLS can filter an UPDATE down to zero rows without an error (e.g.
    // a viewer) — don't announce a move that didn't happen.
    if (!updated || updated.length === 0) {
      return NextResponse.json({ error: "Not allowed to update this deal" }, { status: 403 });
    }

    // Deals created by the AI/automations don't always carry
    // conversation_id — fall back to the contact's latest thread so the
    // move still shows up inline.
    let conversationId = deal.conversation_id as string | null;
    if (!conversationId && deal.contact_id) {
      const { data: conv } = await ctx.supabase
        .from("conversations")
        .select("id")
        .eq("contact_id", deal.contact_id)
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();
      conversationId = conv?.id ?? null;
    }

    // Best-effort — a failed activity log must never undo or mask the
    // stage change that already succeeded above.
    if (conversationId && deal.contact_id) {
      const { data: profile } = await ctx.supabase
        .from("profiles")
        .select("full_name, email")
        .eq("user_id", ctx.userId)
        .maybeSingle();
      const actorName = profile?.full_name || profile?.email || null;
      if (actorName) {
        await logAiActivity(supabaseAdmin(), {
          accountId: ctx.accountId,
          conversationId,
          contactId: deal.contact_id,
          eventType: "stage_changed",
          payload: { stageName: stage.name, stageColor: stage.color, actorName },
        });
      }
    }

    return NextResponse.json({ ok: true, stage: stagePayload });
  } catch (err) {
    return toErrorResponse(err);
  }
}
