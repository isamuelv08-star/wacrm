"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Clock, Sparkles } from "lucide-react"
import { toast } from "sonner"
import { LEAD_SCORE_STYLES, type Score } from "@/components/leads/lead-score-badge"
import { ManageFollowupLeadPanel } from "./manage-followup-lead-panel"
import { Skeleton } from "./skeleton"
import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/client"
import { createFollowupStage } from "@/lib/pipelines/followup-stage"
import type { FollowupLeadItem, FollowupSummary } from "@/lib/dashboard/types"
import { cn } from "@/lib/utils"

const BUCKET_ORDER: Score[] = ["hot", "warm", "cold"]

function initials(name: string | null, phone: string | null): string {
  const source = (name || phone || "?").trim()
  return source.slice(0, 2).toUpperCase()
}

interface FollowupCardProps {
  data: FollowupSummary | null
  loading: boolean
  /** Fired after a lead is moved out of the stage from the manage panel,
   *  so the caller can trigger a refetch instead of waiting on realtime. */
  onLeadMoved?: () => void
}

/**
 * "Seguimiento" — leads sitting in a pipeline stage flagged
 * `is_followup_stage` (migration 077), grouped hot → warm → cold like a
 * hand of poker cards fanned by temperature: hottest on top, coldest at
 * the bottom. Each bucket expands in place to a manageable list; picking
 * a lead opens `ManageFollowupLeadPanel` to act on it without leaving
 * the card. Shared between the Dashboard (account-wide) and the
 * Pipelines page (scoped to the selected pipeline via `loadFollowupLeads`'s
 * `pipelineId` option) — same component, different data.
 */
export function FollowupCard({ data, loading, onLeadMoved }: FollowupCardProps) {
  const t = useTranslations("Dashboard.followup")
  const [expanded, setExpanded] = useState<Score | null>(null)
  const [creatingStageFor, setCreatingStageFor] = useState<string | null>(null)

  const total = data ? data.hot.length + data.warm.length + data.cold.length : null

  async function handleCreateStage(pipelineId: string) {
    setCreatingStageFor(pipelineId)
    try {
      const supabase = createClient()
      const { count } = await supabase
        .from("pipeline_stages")
        .select("id", { count: "exact", head: true })
        .eq("pipeline_id", pipelineId)
      await createFollowupStage(supabase, pipelineId, count ?? 0)
      toast.success(t("stageCreated"))
      onLeadMoved?.()
    } catch {
      toast.error(t("stageCreateError"))
    } finally {
      setCreatingStageFor(null)
    }
  }

  return (
    <section className="flex h-full flex-col rounded-xl border border-border bg-card">
      <header className="flex items-center justify-between border-b border-border px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{t("title")}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {loading || total === null ? t("description") : t("totalInFollowup", { count: total })}
          </p>
        </div>
      </header>

      <div className="flex-1 space-y-2 p-3">
        {!loading && data && data.pipelinesWithoutStage.length > 0 && (
          <div className="space-y-2 rounded-lg border border-dashed border-teal-500/40 bg-teal-500/[0.06] p-3">
            <p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
              <Sparkles className="h-3.5 w-3.5 text-teal-500" />
              {t("noStageBanner")}
            </p>
            <div className="flex flex-wrap gap-2">
              {data.pipelinesWithoutStage.map((p) => (
                <Button
                  key={p.id}
                  size="sm"
                  variant="outline"
                  disabled={creatingStageFor === p.id}
                  onClick={() => handleCreateStage(p.id)}
                  className="h-7 border-teal-500/40 text-xs text-teal-600 hover:bg-teal-500/10 dark:text-teal-400"
                >
                  {creatingStageFor === p.id
                    ? t("creatingStage")
                    : t("createStageFor", { pipeline: p.name })}
                </Button>
              ))}
            </div>
          </div>
        )}

        {loading || !data ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)
        ) : (
          BUCKET_ORDER.map((score) => (
            <FollowupBucketRow
              key={score}
              score={score}
              items={data[score]}
              expanded={expanded === score}
              onToggle={() =>
                setExpanded((cur) => (cur === score ? null : score))
              }
              onLeadMoved={onLeadMoved}
            />
          ))
        )}
      </div>
    </section>
  )
}

function FollowupBucketRow({
  score,
  items,
  expanded,
  onToggle,
  onLeadMoved,
}: {
  score: Score
  items: FollowupLeadItem[]
  expanded: boolean
  onToggle: () => void
  onLeadMoved?: () => void
}) {
  const t = useTranslations("Dashboard.followup")
  const { icon: Icon, className } = LEAD_SCORE_STYLES[score]

  return (
    <div className="rounded-lg border border-border/60">
      <button
        type="button"
        onClick={onToggle}
        disabled={items.length === 0}
        className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-muted/60 disabled:cursor-default disabled:hover:bg-transparent"
      >
        <span
          className={cn(
            "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full",
            className,
          )}
        >
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">
            {t(score, { count: items.length })}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {items.length === 0 ? t("emptyHint") : t(`${score}Hint`)}
          </p>
        </div>

        {/* Overlapping avatar stack, one per waiting lead (capped at 3 +
            a "+N" overflow chip) — same "who's in this pile" idea a
            poker hand or a Slack/GitHub avatar group communicates. */}
        {items.length > 0 && (
          <div className="flex flex-shrink-0 items-center -space-x-2.5">
            {items.slice(0, 3).map((it) => (
              <span
                key={it.dealId}
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-full border-2 border-card text-[10px] font-semibold",
                  className,
                )}
              >
                {initials(it.contactName, it.phone)}
              </span>
            ))}
            {items.length > 3 && (
              <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-card bg-muted text-[10px] font-semibold text-muted-foreground">
                +{items.length - 3}
              </span>
            )}
          </div>
        )}
      </button>

      {expanded && items.length > 0 && (
        <ul className="space-y-1 border-t border-border/60 p-2">
          {items.map((it) => (
            <li key={it.dealId}>
              <ManageFollowupLeadPanel
                lead={it}
                score={score}
                onMoved={onLeadMoved}
                trigger={
                  <button
                    type="button"
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left hover:bg-muted/60",
                      it.isCandidate
                        ? "border-dashed border-teal-500/40"
                        : "border-transparent",
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                      {it.contactName || it.phone || t("unknownLead")}
                    </span>
                    {it.isCandidate && (
                      <span className="flex flex-shrink-0 items-center gap-1 rounded-full bg-teal-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-teal-600 dark:text-teal-400">
                        <Clock className="h-2.5 w-2.5" />
                        {t("candidateBadge")}
                      </span>
                    )}
                    <span className="flex-shrink-0 text-[11px] text-muted-foreground tabular-nums">
                      {t("daysWaiting", { count: it.daysInStage })}
                    </span>
                  </button>
                }
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
