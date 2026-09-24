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
      .select("id, pipeline_id, contact_id, conversation_id")
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

    const { error: updateErr } = await ctx.supabase
      .from("deals")
      .update({ stage_id: stageId })
      .eq("id", dealId);
    if (updateErr) {
      console.error("[PATCH /api/deals/[id]/stage] update error:", updateErr.message);
      return NextResponse.json({ error: "Failed to update stage" }, { status: 500 });
    }

    // Best-effort — a failed activity log must never undo or mask the
    // stage change that already succeeded above.
    if (deal.conversation_id && deal.contact_id) {
      const { data: profile } = await ctx.supabase
        .from("profiles")
        .select("full_name, email")
        .eq("user_id", ctx.userId)
        .maybeSingle();
      const actorName = profile?.full_name || profile?.email || null;
      if (actorName) {
        await logAiActivity(supabaseAdmin(), {
          accountId: ctx.accountId,
          conversationId: deal.conversation_id,
          contactId: deal.contact_id,
          eventType: "stage_changed",
          payload: { stageName: stage.name, stageColor: stage.color, actorName },
        });
      }
    }

    return NextResponse.json({ ok: true, stage: { id: stage.id, name: stage.name, color: stage.color } });
  } catch (err) {
    return toErrorResponse(err);
  }
}
