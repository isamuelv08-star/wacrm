import type { SupabaseClient } from "@supabase/supabase-js";
import type { PipelineStage } from "@/types";

type DB = SupabaseClient;

/** Teal — matches SPEC_DEFAULT_STAGES' "Seguimiento" seed color in
 *  `pipelines/page.tsx`, so a stage created here reads the same
 *  whether it was seeded at pipeline creation or added later. */
const FOLLOWUP_STAGE_COLOR = "#14b8a6";

/**
 * One-click "create the Seguimiento stage" — the FollowupCard's CTA for
 * a pipeline that has none yet, so an admin doesn't have to open
 * Pipeline Settings just to add it by hand. Mirrors the plain insert
 * `handleAddStage()` does in `pipeline-settings.tsx` (same columns,
 * appended at the end via `position`), plus `is_followup_stage: true` —
 * the migration 077 partial unique index rejects a second one on the
 * same pipeline, so this is safe to call even from a stale UI state.
 */
export async function createFollowupStage(
  db: DB,
  pipelineId: string,
  currentStageCount: number,
): Promise<PipelineStage> {
  const { data, error } = await db
    .from("pipeline_stages")
    .insert({
      pipeline_id: pipelineId,
      name: "Seguimiento",
      color: FOLLOWUP_STAGE_COLOR,
      position: currentStageCount,
      win_probability: 20,
      is_followup_stage: true,
    })
    .select()
    .single();
  if (error || !data) {
    throw error ?? new Error("createFollowupStage: insert returned no row");
  }
  return data as PipelineStage;
}
