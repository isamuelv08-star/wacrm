"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { MessageSquare, Trophy, XCircle } from "lucide-react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { LeadScoreBadge, type Score } from "@/components/leads/lead-score-badge"
import { createClient } from "@/lib/supabase/client"
import type { FollowupLeadItem } from "@/lib/dashboard/types"

interface StageOption {
  id: string
  name: string
  is_won_stage?: boolean
  is_lost_stage?: boolean
}

interface ManageFollowupLeadPanelProps {
  lead: FollowupLeadItem
  score: Score
  trigger: React.ReactElement
  /** Called after the deal is moved out of Seguimiento (won/lost/manual
   *  stage pick), so the caller can drop it from the bucket without
   *  waiting for the next realtime refresh. */
  onMoved?: () => void
}

/**
 * Popover opened from a "Seguimiento" card row (Dashboard + Pipelines) —
 * lets an agent act on the lead without leaving the card: jump to the
 * chat, reclassify hot/warm/cold, or move the deal to any stage in its
 * pipeline (including the quick Won/Lost shortcuts). Moving the stage is
 * a plain `deals.update({ stage_id })`, same as the kanban's drag-and-
 * drop — the stage-outcome sync trigger (migration 060) keeps
 * deals.status consistent automatically.
 */
export function ManageFollowupLeadPanel({
  lead,
  score,
  trigger,
  onMoved,
}: ManageFollowupLeadPanelProps) {
  const t = useTranslations("Dashboard.followup")
  const [open, setOpen] = useState(false)
  const [stages, setStages] = useState<StageOption[]>([])
  const [moving, setMoving] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    const supabase = createClient()
    supabase
      .from("pipeline_stages")
      .select("id, name, is_won_stage, is_lost_stage")
      .eq("pipeline_id", lead.pipelineId)
      .order("position", { ascending: true })
      .then(({ data }) => {
        if (!cancelled) setStages((data as StageOption[]) ?? [])
      })
    return () => {
      cancelled = true
    }
  }, [open, lead.pipelineId])

  async function moveTo(stageId: string | null) {
    if (!stageId || stageId === lead.stageId) return
    setMoving(true)
    const supabase = createClient()
    const { error } = await supabase
      .from("deals")
      .update({ stage_id: stageId })
      .eq("id", lead.dealId)
    setMoving(false)
    if (error) {
      toast.error(t("moveError"))
      return
    }
    toast.success(t("moveSuccess"))
    setOpen(false)
    onMoved?.()
  }

  const wonStage = stages.find((s) => s.is_won_stage)
  const lostStage = stages.find((s) => s.is_lost_stage)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={trigger} />
      <PopoverContent className="w-72" onClick={(e) => e.stopPropagation()}>
        <div>
          <p className="truncate text-sm font-medium text-foreground">
            {lead.contactName || lead.phone || t("unknownLead")}
          </p>
          {lead.contactName && lead.phone && (
            <p className="truncate text-xs text-muted-foreground">{lead.phone}</p>
          )}
        </div>

        <div className="flex items-center justify-between gap-2">
          <LeadScoreBadge score={score} editable contactId={lead.contactId ?? undefined} />
          {lead.conversationId && (
            <Link
              href={`/inbox?c=${lead.conversationId}`}
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              <MessageSquare className="h-3 w-3" />
              {t("goToChat")}
            </Link>
          )}
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            {t("moveToStage")}
          </label>
          <Select value={lead.stageId} onValueChange={moveTo} disabled={moving || stages.length === 0}>
            <SelectTrigger className="h-8 w-full bg-muted text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {stages.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex gap-2">
          {wonStage && (
            <Button
              size="sm"
              variant="outline"
              className="flex-1 text-xs"
              disabled={moving}
              onClick={() => moveTo(wonStage.id)}
            >
              <Trophy className="mr-1 h-3 w-3" />
              {t("markWon")}
            </Button>
          )}
          {lostStage && (
            <Button
              size="sm"
              variant="outline"
              className="flex-1 text-xs"
              disabled={moving}
              onClick={() => moveTo(lostStage.id)}
            >
              <XCircle className="mr-1 h-3 w-3" />
              {t("markLost")}
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
