"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Pencil, RefreshCw } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { ensureDefaultPipeline } from "@/lib/pipelines/default-stages";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { PipelineStage } from "@/types";

type LoadState = "creating" | "ready" | "error";

/**
 * Onboarding's pipeline step — creates the account's default pipeline
 * for real (via `ensureDefaultPipeline`, idempotent) and shows the 6
 * stages it just created as a renamable preview, instead of the old
 * static text that falsely claimed a pipeline already existed (see
 * the onboarding audit's #1 critical finding: no pipeline meant every
 * WhatsApp lead was silently dropped by webhook-processor.ts /
 * lead-scoring.ts's "account has no pipeline yet" guard).
 */
export function PipelineStep() {
  const t = useTranslations("Onboarding.pipeline");
  const supabase = createClient();
  const { accountId, user } = useAuth();

  const [state, setState] = useState<LoadState>("creating");
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  const loadStages = async (pipelineId: string) => {
    const { data } = await supabase
      .from("pipeline_stages")
      .select("*")
      .eq("pipeline_id", pipelineId)
      .order("position");
    setStages((data ?? []) as PipelineStage[]);
  };

  const run = async () => {
    if (!accountId || !user) return;
    setState("creating");
    const pipeline = await ensureDefaultPipeline(supabase, accountId, user.id);
    if (!pipeline) {
      setState("error");
      return;
    }
    await loadStages(pipeline.id);
    setState("ready");
  };

  useEffect(() => {
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, user?.id]);

  const startEdit = (stage: PipelineStage) => {
    setEditingId(stage.id);
    setEditingName(stage.name);
  };

  const saveEdit = async () => {
    if (!editingId) return;
    const name = editingName.trim();
    const id = editingId;
    setEditingId(null);
    if (!name) return;
    setStages((prev) => prev.map((s) => (s.id === id ? { ...s, name } : s)));
    await supabase.from("pipeline_stages").update({ name }).eq("id", id);
  };

  if (state === "creating") {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("creating")}
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="flex flex-col items-start gap-3 py-2 text-sm">
        <p className="text-muted-foreground">{t("createFailed")}</p>
        <Button type="button" variant="outline" size="sm" onClick={() => void run()}>
          <RefreshCw className="h-3.5 w-3.5" />
          {t("retry")}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">{t("readyBody")}</p>
      <div className="flex flex-wrap gap-2">
        {stages.map((stage) => (
          <div
            key={stage.id}
            className="group flex items-center gap-2 rounded-full border border-border bg-muted/30 py-1.5 pr-3 pl-2.5 text-sm"
          >
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: stage.color }}
              aria-hidden
            />
            {editingId === stage.id ? (
              <Input
                autoFocus
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                onBlur={() => void saveEdit()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void saveEdit();
                  if (e.key === "Escape") setEditingId(null);
                }}
                className="h-6 w-32 px-1.5 py-0 text-sm"
              />
            ) : (
              <>
                <span className="text-foreground">{stage.name}</span>
                <button
                  type="button"
                  onClick={() => startEdit(stage)}
                  className="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                  aria-label={t("renameStage")}
                >
                  <Pencil className="h-3 w-3" />
                </button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
