import type { SupabaseClient } from "@supabase/supabase-js";
import type { Pipeline } from "@/types";

/**
 * Spec-defined seed — name and color per the product spec. Won/Lost
 * carry their outcome flag straight from creation (migration 060's
 * sync trigger reads it off `pipeline_stages`) so a brand-new pipeline
 * already registers a drag into either one — no trip to Settings
 * needed just to get the default board working. Same reasoning for
 * `winProbability` (the dashboard forecast skips stages that have
 * none) and `isQualifiedStage` (the pipeline's "reached qualified"
 * metric hides itself entirely without one): a migration can only
 * backfill pipelines that already exist, so the seed has to carry
 * both or every newly created pipeline reappears with those two
 * metrics reading zero. Probabilities follow the same 10%-90% ramp
 * across open stages that computeStageProbability() applies.
 * Seguimiento (is_followup_stage) is deliberately NOT part of this
 * seed — it's created exactly one way, for every pipeline alike
 * (brand-new or years-old): the one-click CTA on the Dashboard's
 * FollowupCard (src/lib/pipelines/followup-stage.ts). Seeding it here
 * too would give new pipelines a second, silent creation path that
 * skips that CTA, so an account with several pipelines could end up
 * with some auto-seeded and some not — the single-path-only guarantee
 * is the whole point.
 *
 * Shared by the Pipelines page's own "board is empty" seed and the
 * onboarding wizard's pipeline step (see ensureDefaultPipeline below)
 * — previously duplicated between the two, which risked them drifting
 * apart over time.
 */
export const SPEC_DEFAULT_STAGES = [
  { name: "New Lead", color: "#3b82f6", position: 0, winProbability: 10 }, // blue
  { name: "Qualified", color: "#eab308", position: 1, winProbability: 37, isQualifiedStage: true }, // yellow
  { name: "Proposal Sent", color: "#f97316", position: 2, winProbability: 63 }, // orange
  { name: "Negotiation", color: "#8b5cf6", position: 3, winProbability: 90 }, // purple
  { name: "Won", color: "#22c55e", position: 4, isWonStage: true, winProbability: 100 }, // green
  { name: "Lost", color: "#ef4444", position: 5, isLostStage: true, winProbability: 0 }, // red
];

export function defaultStageRows(pipelineId: string) {
  return SPEC_DEFAULT_STAGES.map((s) => ({
    pipeline_id: pipelineId,
    name: s.name,
    color: s.color,
    position: s.position,
    is_won_stage: "isWonStage" in s ? s.isWonStage : false,
    is_lost_stage: "isLostStage" in s ? s.isLostStage : false,
    is_qualified_stage: "isQualifiedStage" in s ? s.isQualifiedStage : false,
    is_followup_stage: false,
    win_probability: s.winProbability,
  }));
}

/**
 * Guarantees the account has at least one pipeline, creating the spec
 * default (with its 6 stages) if none exists yet. Idempotent and
 * safe to call from multiple places — it checks first, so calling it
 * twice (e.g. once from the onboarding wizard's pipeline step, once
 * again from /api/onboarding/complete as a fallback for whoever
 * skips onboarding before reaching that step) never double-creates.
 *
 * This is the fix for the onboarding audit's #1 critical finding: the
 * wizard used to just show static text claiming a pipeline already
 * existed, when `handle_new_user()` never creates one — leads coming
 * in over WhatsApp before anyone happened to visit /pipelines (which
 * auto-seeds on first visit) were silently dropped by
 * webhook-processor.ts / lead-scoring.ts's "account has no pipeline
 * yet" guard, never becoming a deal.
 *
 * Returns the existing or newly-created pipeline, or null on error
 * (logged, never thrown — onboarding must not get stuck on this).
 */
export async function ensureDefaultPipeline(
  supabase: SupabaseClient,
  accountId: string,
  userId: string,
): Promise<Pipeline | null> {
  const { data: existing, error: listError } = await supabase
    .from("pipelines")
    .select("*")
    .eq("account_id", accountId)
    .order("created_at")
    .limit(1);

  if (listError) {
    console.error("[ensureDefaultPipeline] list error:", listError.message);
    return null;
  }
  if (existing && existing.length > 0) {
    return existing[0] as Pipeline;
  }

  const { data: pipeline, error: insertError } = await supabase
    .from("pipelines")
    .insert({ user_id: userId, account_id: accountId, name: "Sales Pipeline" })
    .select()
    .single();

  if (insertError || !pipeline) {
    console.error("[ensureDefaultPipeline] pipeline insert error:", insertError?.message);
    return null;
  }

  const { error: stagesError } = await supabase
    .from("pipeline_stages")
    .insert(defaultStageRows(pipeline.id));

  if (stagesError) {
    console.error("[ensureDefaultPipeline] stages insert error:", stagesError.message);
  }

  return pipeline as Pipeline;
}
