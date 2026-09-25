"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Pipeline, PipelineStage, Deal } from "@/types";
import type { ConversationStaleness } from "@/lib/pipelines/lead-staleness";
import { PipelineBoard } from "@/components/pipelines/pipeline-board";
import { PipelineSettings } from "@/components/pipelines/pipeline-settings";
import { DealForm } from "@/components/pipelines/deal-form";
import { LeadSummarySheet } from "@/components/pipelines/lead-summary-sheet";
import { PipelineAnalytics } from "@/components/pipelines/pipeline-analytics";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GitBranch, Plus, ChevronDown, Settings, CalendarRange } from "lucide-react";
import { toast } from "sonner";
import { useCan } from "@/hooks/use-can";
import { useAuth } from "@/hooks/use-auth";
import { readViewCache, writeViewCache } from "@/lib/cache/view-cache";
import { useDebouncedCallback } from "@/hooks/use-debounced-callback";
import { GatedButton } from "@/components/ui/gated-button";
import { useTranslations } from "next-intl";
import { defaultStageRows, ensureDefaultPipeline } from "@/lib/pipelines/default-stages";
import { selectAll } from "@/lib/supabase/fetch-all";

// Pipeline creation is admin-class (settings-tier write under
// the new RLS); deal creation is operational and only requires
// agent+. The two CTAs gate on different `useCan` capabilities,
// not on different copy.

// Persists the "group stale leads by date" board preference across
// visits — same try/catch localStorage idiom as sidebar.tsx's
// SIDEBAR_COLLAPSED_STORAGE_KEY.
const GROUP_BY_DATE_STORAGE_KEY = "saleslid:pipeline:group-by-date";

export default function PipelinesPage() {
  const t = useTranslations("Pipelines.page");
  const tBoard = useTranslations("Pipelines.board");
  const supabase = createClient();
  const canEditSettings = useCan("edit-settings");
  const canCreateDeals = useCan("send-messages");
  const { accountId, user } = useAuth();

  // Last-known board (per user) so returning to Pipelines paints the
  // kanban on the first frame instead of the skeleton; the loads below
  // still refresh it. See lib/cache/view-cache.ts.
  const boardCacheKey = user?.id ? `pipelines:board:${user.id}` : null;
  const cachedBoard = useState(() =>
    readViewCache<{
      pipelines: Pipeline[];
      selectedPipelineId: string;
      stages: PipelineStage[];
      deals: Deal[];
    }>(boardCacheKey),
  )[0];
  const hadCachedBoard = useRef(!!cachedBoard);

  const [pipelines, setPipelines] = useState<Pipeline[]>(cachedBoard?.pipelines ?? []);
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>(
    cachedBoard?.selectedPipelineId ?? "",
  );
  const [stages, setStages] = useState<PipelineStage[]>(cachedBoard?.stages ?? []);
  const [deals, setDeals] = useState<Deal[]>(cachedBoard?.deals ?? []);
  const [loading, setLoading] = useState(!cachedBoard);
  useEffect(() => {
    if (boardCacheKey && !loading && pipelines.length > 0) {
      writeViewCache(boardCacheKey, { pipelines, selectedPipelineId, stages, deals });
    }
  }, [boardCacheKey, loading, pipelines, selectedPipelineId, stages, deals]);
  // Keyed by contact_id — drives each open deal card's "cooling off"
  // badge. Refetched below whenever the open deals' contact set
  // changes; the badge itself then ticks live client-side off
  // `last_message_at` between refetches (lead-staleness-badge.tsx).
  const [conversationStaleness, setConversationStaleness] = useState<
    Map<string, ConversationStaleness>
  >(new Map());

  // "Todos / Mis leads / Sin asignar" — client-side only, over
  // `deal.assignee` (already joined via `assignee:profiles!deals_assigned_to_fkey(*)`
  // below), so it needs no extra fetch.
  const [assigneeFilter, setAssigneeFilter] = useState<"all" | "mine" | "unassigned">("all");
  const visibleDeals = useMemo(() => {
    if (assigneeFilter === "mine") return deals.filter((d) => d.assignee?.user_id === user?.id);
    if (assigneeFilter === "unassigned") return deals.filter((d) => !d.assigned_to);
    return deals;
  }, [deals, assigneeFilter, user?.id]);

  // "Group stale leads by date" board display mode — off by default
  // (opt-in), persisted client-side only, no effect on what's fetched.
  const [groupByDate, setGroupByDate] = useState(false);
  useEffect(() => {
    try {
      const stored = localStorage.getItem(GROUP_BY_DATE_STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (stored !== null) setGroupByDate(stored === "true");
    } catch {
      // localStorage can throw in private-browsing/sandboxed contexts.
    }
  }, []);
  const toggleGroupByDate = useCallback(() => {
    setGroupByDate((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(GROUP_BY_DATE_STORAGE_KEY, String(next));
      } catch {
        // Persistence is best-effort; ignore storage failures.
      }
      return next;
    });
  }, []);

  // Dialog / sheet state
  const [newPipelineOpen, setNewPipelineOpen] = useState(false);
  const [newPipelineName, setNewPipelineName] = useState("");
  const [creating, setCreating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Deal form state is lifted here so both the top-bar "Add Deal" and
  // the per-column "+" trigger the same Sheet.
  const [dealFormOpen, setDealFormOpen] = useState(false);
  const [editingDeal, setEditingDeal] = useState<Deal | null>(null);
  const [defaultStageId, setDefaultStageId] = useState<string>("");

  // Guard against double-seeding (React StrictMode double-effect in dev).
  const seedAttempted = useRef(false);

  const loadPipelines = useCallback(async () => {
    const { data, error } = await supabase
      .from("pipelines")
      .select("*")
      .order("created_at");
    if (error) {
      console.error("Failed to load pipelines:", error.message);
      return [];
    }
    return data ?? [];
  }, [supabase]);

  const loadStages = useCallback(
    async (pipelineId: string) => {
      const { data } = await supabase
        .from("pipeline_stages")
        .select("*")
        .eq("pipeline_id", pipelineId)
        .order("position");
      return data ?? [];
    },
    [supabase],
  );

  const loadDeals = useCallback(
    async (pipelineId: string) => {
      // Paged: one deal is auto-created per inbound contact, so a busy
      // pipeline passes Supabase's 1000-row cap and the board silently
      // dropped the oldest cards.
      const { data } = await selectAll<Deal>(() =>
        supabase
          .from("deals")
          .select("*, contact:contacts(*), assignee:profiles!deals_assigned_to_fkey(*)")
          .eq("pipeline_id", pipelineId)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false }),
      ).catch((err) => {
        console.error("Failed to load deals:", err);
        return { data: [] as Deal[] };
      });
      return data;
    },
    [supabase],
  );

  const seedDefaultPipeline = useCallback(async (): Promise<Pipeline | null> => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) return null;
    // pipelines.account_id is NOT NULL post-017 with no DB default.
    if (!accountId) return null;

    return ensureDefaultPipeline(supabase, accountId, user.id);
  }, [supabase, accountId]);

  // Initial load + seed-if-empty
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!hadCachedBoard.current) setLoading(true);
      let list = await loadPipelines();

      if (list.length === 0 && !seedAttempted.current) {
        seedAttempted.current = true;
        const seeded = await seedDefaultPipeline();
        if (seeded) list = await loadPipelines();
      }

      if (cancelled) return;
      setPipelines(list);
      if (list.length > 0) {
        setSelectedPipelineId((prev) =>
          prev && list.some((p) => p.id === prev) ? prev : list[0].id,
        );
      } else {
        setSelectedPipelineId("");
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadPipelines, seedDefaultPipeline]);

  // Load stages + deals whenever selected pipeline changes.
  // Clearing on no-selection is a legitimate sync with URL/prop
  // state; the load completion uses async setters inside promise
  // callbacks (not synchronous in the effect body).
  useEffect(() => {
    if (!selectedPipelineId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStages([]);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDeals([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const [s, d] = await Promise.all([
        loadStages(selectedPipelineId),
        loadDeals(selectedPipelineId),
      ]);
      if (cancelled) return;
      setStages(s);
      setDeals(d);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedPipelineId, loadStages, loadDeals]);

  // Conversation staleness for every OPEN deal's contact — won/lost
  // deals don't get a badge (see deal-card.tsx), so their contacts are
  // deliberately excluded from this fetch.
  useEffect(() => {
    const openContactIds = Array.from(
      new Set(
        deals
          .filter((d) => d.status === "open" && d.contact_id)
          .map((d) => d.contact_id as string),
      ),
    );
    if (openContactIds.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setConversationStaleness(new Map());
      return;
    }
    let cancelled = false;
    (async () => {
      // Chunked: a few hundred UUIDs in one `.in()` exceeds proxy URL
      // limits (414) and every staleness badge disappeared.
      const CHUNK = 150;
      const rows: { contact_id: string | null; last_message_at: string | null; last_message_sender_type: string | null }[] = [];
      for (let i = 0; i < openContactIds.length; i += CHUNK) {
        const { data, error } = await supabase
          .from("conversations")
          .select("contact_id, last_message_at, last_message_sender_type")
          .in("contact_id", openContactIds.slice(i, i + CHUNK));
        if (cancelled) return;
        if (error) {
          console.error("Failed to load conversation staleness:", error.message);
          return;
        }
        rows.push(...(data ?? []));
      }
      const map = new Map<string, ConversationStaleness>();
      for (const row of rows) {
        if (row.contact_id) {
          map.set(row.contact_id, {
            last_message_at: row.last_message_at,
            last_message_sender_type: row.last_message_sender_type,
          });
        }
      }
      setConversationStaleness(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [deals, supabase]);

  const refreshPipelines = useCallback(async () => {
    const list = await loadPipelines();
    setPipelines(list);
    if (list.length === 0) setSelectedPipelineId("");
    else if (!list.some((p) => p.id === selectedPipelineId))
      setSelectedPipelineId(list[0].id);
  }, [loadPipelines, selectedPipelineId]);

  const refreshStages = useCallback(async () => {
    if (!selectedPipelineId) return;
    setStages(await loadStages(selectedPipelineId));
  }, [loadStages, selectedPipelineId]);

  const refreshDeals = useCallback(async () => {
    if (!selectedPipelineId) return;
    setDeals(await loadDeals(selectedPipelineId));
  }, [loadDeals, selectedPipelineId]);

  // Coalesces a burst of deal-change events (a bulk import, an
  // automation touching many deals at once) into one `refreshDeals()`
  // instead of one per row changed.
  const debouncedRefreshDeals = useDebouncedCallback(refreshDeals, 500, 2000);

  // Live updates — this page had no realtime subscription at all, so
  // a deal created/moved/edited by a teammate (or an automation, or
  // the AI bot) never showed up here without a manual reload. Same
  // postgres_changes + account-scoped filter pattern the dashboard
  // already uses for its own sales section.
  useEffect(() => {
    if (!accountId) return;
    const channel = supabase
      .channel(`pipelines:${accountId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "deals", filter: `account_id=eq.${accountId}` },
        () => debouncedRefreshDeals(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [accountId, supabase, debouncedRefreshDeals]);

  const handleDealMoved = useCallback(
    async (dealId: string, newStageId: string) => {
      // Optimistic update — board already animated; just persist.
      setDeals((prev) =>
        prev.map((d) => (d.id === dealId ? { ...d, stage_id: newStageId } : d)),
      );
      const { error } = await supabase
        .from("deals")
        .update({ stage_id: newStageId })
        .eq("id", dealId);
      if (error) {
        toast.error(t("toastFailedMoveDeal"));
        refreshDeals();
      }
    },
    [supabase, refreshDeals, t],
  );

  const handleAddDeal = useCallback(
    (stageId?: string) => {
      setEditingDeal(null);
      setDefaultStageId(stageId ?? stages[0]?.id ?? "");
      setDealFormOpen(true);
    },
    [stages],
  );

  // Clicking a card opens the read-first lead summary (LeadSummarySheet)
  // instead of jumping straight to the edit form — that sheet has its
  // own "Edit" tab (DealFormFields, embedded) for when fields actually
  // need changing, so editing is still there, just no longer the
  // default. `DealForm` below is left rendering only `handleAddDeal`'s
  // create flow now (a brand-new deal has no lead to summarize yet);
  // `editingDeal` stays permanently null on this page as a result —
  // still a real prop DealForm supports for contact-sidebar.tsx's own
  // "click a deal" path, just unused from here.
  const [summaryDeal, setSummaryDeal] = useState<Deal | null>(null);
  const [summarySheetOpen, setSummarySheetOpen] = useState(false);
  const handleOpenDealSummary = useCallback((deal: Deal) => {
    setSummaryDeal(deal);
    setSummarySheetOpen(true);
  }, []);

  async function handleCreatePipeline() {
    const name = newPipelineName.trim();
    if (!name) return;
    setCreating(true);

    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) {
      setCreating(false);
      return;
    }
    // pipelines.account_id is NOT NULL post-017 with no DB default.
    if (!accountId) {
      toast.error(t("toastNotLinkedToAccount"));
      setCreating(false);
      return;
    }

    const { data: pipeline, error } = await supabase
      .from("pipelines")
      .insert({ user_id: user.id, account_id: accountId, name })
      .select()
      .single();

    if (error || !pipeline) {
      toast.error(t("toastFailedCreatePipeline"));
      setCreating(false);
      return;
    }

    await supabase.from("pipeline_stages").insert(defaultStageRows(pipeline.id));

    setNewPipelineName("");
    setNewPipelineOpen(false);
    setSelectedPipelineId(pipeline.id);
    await refreshPipelines();
    setCreating(false);
    toast.success(t("toastPipelineCreated"));
  }

  const selectedPipeline = pipelines.find((p) => p.id === selectedPipelineId);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="h-8 w-48 animate-pulse rounded bg-muted" />
          <div className="h-9 w-28 animate-pulse rounded-lg bg-muted" />
        </div>
        <div className="flex gap-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-96 w-72 animate-pulse rounded-xl bg-muted/50" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {/* Pipeline selector dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors data-[popup-open]:bg-muted"
            >
              <GitBranch className="h-4 w-4 text-primary" />
              <span className="font-semibold">
                {selectedPipeline?.name ?? t("selectPipeline")}
              </span>
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="w-64 border-border bg-popover text-popover-foreground"
            >
              {pipelines.length === 0 && (
                <DropdownMenuItem disabled className="text-muted-foreground">
                  {t("noPipelinesYet")}
                </DropdownMenuItem>
              )}
              {pipelines.map((p) => (
                <DropdownMenuItem
                  key={p.id}
                  onClick={() => setSelectedPipelineId(p.id)}
                  className={
                    p.id === selectedPipelineId
                      ? "text-primary"
                      : "text-popover-foreground"
                  }
                >
                  <GitBranch className="mr-2 h-3.5 w-3.5" />
                  {p.name}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator className="bg-border" />
              {selectedPipeline && (
                <DropdownMenuItem
                  onClick={() => setSettingsOpen(true)}
                  className="text-popover-foreground"
                >
                  <Settings className="mr-2 h-3.5 w-3.5" />
                  {t("managePipelines")}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Todos / Mis leads / Sin asignar — same "small pill group"
              idiom as the AI settings presets (ai-config.tsx). */}
          <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-0.5">
            {(["all", "mine", "unassigned"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setAssigneeFilter(v)}
                className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  assigneeFilter === v
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t(`assigneeFilter_${v}`)}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={toggleGroupByDate}
            aria-pressed={groupByDate}
            title={groupByDate ? tBoard("ungroupByDate") : tBoard("groupByDate")}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-xs font-medium transition-colors ${
              groupByDate
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border bg-card text-muted-foreground hover:text-foreground"
            }`}
          >
            <CalendarRange className="h-3.5 w-3.5" />
            {tBoard("groupByDate")}
          </button>
        </div>

        <div className="flex items-center gap-2">
          <GatedButton
            variant="outline"
            canAct={canEditSettings}
            gateReason="create pipelines"
            onClick={() => setNewPipelineOpen(true)}
            className="border-border bg-card text-foreground hover:bg-muted"
          >
            <Plus className="mr-1 h-4 w-4" />
            {t("addPipeline")}
          </GatedButton>
          <GatedButton
            canAct={canCreateDeals}
            gateReason="create deals"
            disabled={!selectedPipelineId || stages.length === 0}
            onClick={() => handleAddDeal()}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="mr-1 h-4 w-4" />
            {t("addDeal")}
          </GatedButton>
        </div>
      </div>

      {/* Board */}
      {pipelines.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-20">
          <GitBranch className="h-12 w-12 text-muted-foreground" />
          <h3 className="mt-4 text-lg font-medium text-foreground">
            {t("noPipelinesYet")}
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("createToStartTracking")}
          </p>
          <GatedButton
            canAct={canEditSettings}
            gateReason="create pipelines"
            onClick={() => setNewPipelineOpen(true)}
            className="mt-4 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="mr-1 h-4 w-4" />
            {t("createPipeline")}
          </GatedButton>
        </div>
      ) : (
        <>
          <PipelineAnalytics
            pipelineId={selectedPipelineId}
            pipelineName={selectedPipeline?.name ?? ""}
            stages={stages}
            deals={visibleDeals}
          />
          <PipelineBoard
            stages={stages}
            deals={visibleDeals}
            onDealMoved={handleDealMoved}
            onAddDeal={handleAddDeal}
            onEditDeal={handleOpenDealSummary}
            conversationStaleness={conversationStaleness}
            groupByDate={groupByDate}
          />
        </>
      )}

      {/* New Pipeline Dialog */}
      <Dialog open={newPipelineOpen} onOpenChange={setNewPipelineOpen}>
        <DialogContent className="sm:max-w-sm bg-popover border-border">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">{t("newPipeline")}</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <Label className="text-muted-foreground">{t("pipelineName")}</Label>
            <Input
              value={newPipelineName}
              onChange={(e) => setNewPipelineName(e.target.value)}
              placeholder={t("pipelineNamePlaceholder")}
              className="mt-2 bg-muted border-border text-foreground"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreatePipeline();
              }}
            />
            <p className="mt-2 text-xs text-muted-foreground">
              {t("defaultStagesDesc")}
            </p>
          </div>
          <DialogFooter className="bg-popover/50 border-border">
            <Button
              variant="outline"
              onClick={() => setNewPipelineOpen(false)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              {t("cancel")}
            </Button>
            <Button
              onClick={handleCreatePipeline}
              disabled={creating || !newPipelineName.trim()}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {creating ? t("creating") : t("createPipelineBtn")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pipeline Settings */}
      {selectedPipeline && (
        <PipelineSettings
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          pipeline={selectedPipeline}
          stages={stages}
          onPipelinesChanged={refreshPipelines}
          onStagesChanged={refreshStages}
          onCreateNewPipeline={() => {
            setSettingsOpen(false);
            setNewPipelineOpen(true);
          }}
        />
      )}

      {/* Deal Form (Sheet) */}
      <DealForm
        open={dealFormOpen}
        onOpenChange={setDealFormOpen}
        deal={editingDeal}
        pipelineId={selectedPipelineId}
        stages={stages}
        defaultStageId={defaultStageId}
        onSaved={refreshDeals}
      />

      {/* Lead summary (Sheet) — what a card click opens by default. */}
      <LeadSummarySheet
        deal={summaryDeal}
        open={summarySheetOpen}
        onOpenChange={setSummarySheetOpen}
        pipelineId={selectedPipelineId}
        stages={stages}
        onSaved={refreshDeals}
      />
    </div>
  );
}
