"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import type { Contact, Deal, Tag, PipelineStage, Message } from "@/types";
import { collectMediaGallery } from "@/lib/media/gallery";
import { readViewCache, writeViewCache } from "@/lib/cache/view-cache";
import { MediaLightbox } from "./media-lightbox";
import {
  Phone,
  Mail,
  Copy,
  Check,
  Tag as TagIcon,
  DollarSign,
  StickyNote,
  Building2,
  Sparkles,
  SlidersHorizontal,
  PanelRightOpen,
  PanelRightClose,
  Images,
  PlayCircle,
  Layers,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DealForm } from "@/components/pipelines/deal-form";
import { ContactNotesPanel } from "@/components/contacts/contact-notes-panel";
import { LeadSummaryCompact } from "./lead-summary-compact";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { useTranslations } from "next-intl";
import { fetchAiAccountStatus, toggleAiAutoReply } from "@/lib/ai/autoreply-toggle";
import {
  fetchContactCustomFields,
  saveContactCustomFieldValue,
  type CustomFieldWithValue,
} from "@/lib/contacts/custom-fields";
import { LeadScoreBadge } from "@/components/leads/lead-score-badge";

interface ContactSidebarProps {
  contact: Contact | null;
  /** Active conversation — drives the AI switch below. Absent (no thread
   *  selected yet) simply hides that section. */
  conversationId?: string | null;
  /** `conversations.ai_autoreply_disabled` for the active conversation. */
  aiAutoreplyDisabled?: boolean;
  /** Current assignee — mirrors AiThreadBanner's suppression rule (bot
   *  active but a human already owns the thread → nothing to toggle). */
  assignedAgentId?: string | null;
  /** Called after a successful toggle so the parent (and the chat-footer
   *  AiThreadBanner, fed by the same lifted state) stay in sync — see
   *  inbox/page.tsx's handleAiAutoReplyChange. */
  onAiAutoReplyChange?: (conversationId: string, disabled: boolean) => void;
  /**
   * Whether the panel is expanded. Defaults to `true` so callers that
   * don't wire up collapsing just get the panel as before. When `false`,
   * the panel renders as a slim icon rail instead of unmounting — the
   * same "always mounted, collapses to a rail" pattern the main nav
   * Sidebar uses, so the reopen affordance lives on the panel itself
   * rather than bolted onto an unrelated control elsewhere (previously
   * the message thread's header, wedged between the status and assign
   * dropdowns).
   */
  open?: boolean;
  /** Flips `open`. Omit to render the panel with no collapse control. */
  onToggle?: () => void;
  /** The active thread's messages — drives the "Media" tray below (every
   *  image/video the customer sent or we sent, newest first). Absent
   *  (no thread loaded yet) just hides that section. */
  messages?: Message[];
}

/**
 * Same stale-while-revalidate contract as the inbox's message cache
 * (lib/cache/view-cache.ts, inbox/page.tsx's messagesCacheKey): this
 * panel used to hard-clear deals/tags/custom fields to empty on every
 * contact switch (see the comment on that reset effect below), then
 * refetch — a visible blank-then-repopulate flash on every single chat
 * switch, since this panel is always on screen next to the thread.
 * Caching its last-known snapshot per contact removes that flash the
 * same way the message thread's own cache already does.
 */
function contactPanelCacheKey(userId: string | undefined, contactId: string): string | null {
  return userId ? `inbox:contactPanel:${userId}:${contactId}` : null;
}

interface ContactPanelSnapshot {
  deals: Deal[];
  tags: (Tag & { contact_tag_id: string })[];
  customFields: CustomFieldWithValue[];
}

export function ContactSidebar({
  contact,
  conversationId,
  aiAutoreplyDisabled = false,
  assignedAgentId,
  onAiAutoReplyChange,
  open = true,
  onToggle,
  messages,
}: ContactSidebarProps) {
  const tSidebar = useTranslations("Inbox.sidebar");
  const tThread = useTranslations("Inbox.messageThread");
  const tAiBanner = useTranslations("Inbox.aiBanner");

  const { accountId, user } = useAuth();
  const [copied, setCopied] = useState(false);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [tags, setTags] = useState<(Tag & { contact_tag_id: string })[]>([]);

  // Media tray — every image/video in the thread, newest first (the
  // gallery helper itself returns thread order, oldest first, which is
  // what the lightbox's ← / → expects; reverse only for the grid so the
  // most recent share is the first thumbnail). Own lightbox instance
  // rather than sharing MessageThread's — simpler than lifting that
  // state up to the page, and having two mounted (only one ever "open")
  // is harmless.
  const mediaGallery = useMemo(() => collectMediaGallery(messages ?? []), [messages]);
  const mediaGalleryNewestFirst = useMemo(
    () => [...mediaGallery].reverse(),
    [mediaGallery],
  );
  const [openMediaId, setOpenMediaId] = useState<string | null>(null);

  // Inline-editable contact fields. Local drafts re-seed whenever the
  // selected contact changes; saved on blur (only when actually dirty)
  // via a direct `contacts` update — same pattern contact-form.tsx uses,
  // RLS already scopes the write to the caller's account.
  const [emailDraft, setEmailDraft] = useState("");
  const [companyDraft, setCompanyDraft] = useState("");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEmailDraft(contact?.email ?? "");
    setCompanyDraft(contact?.company ?? "");
  }, [contact?.id, contact?.email, contact?.company]);

  // Manual lead-score override (migration 061) — same "local draft the
  // caller updates on a successful save" posture as email/company above,
  // since `contact` itself isn't re-fetched after the popover's write.
  const [scoreOverride, setScoreOverride] = useState<{
    score: "hot" | "warm" | "cold";
    reason: string | null;
  } | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setScoreOverride(null);
  }, [contact?.id]);

  const saveContactField = useCallback(
    async (field: "email" | "company", value: string, previous: string | undefined) => {
      if (!contact) return;
      const trimmed = value.trim();
      if (trimmed === (previous ?? "")) return; // not dirty — skip the write
      const supabase = createClient();
      const { error } = await supabase
        .from("contacts")
        .update({ [field]: trimmed || null, updated_at: new Date().toISOString() })
        .eq("id", contact.id);
      if (error) {
        console.error(`Failed to update contact ${field}:`, error.message);
        toast.error(tSidebar("saveFieldError"));
      }
    },
    [contact, tSidebar],
  );

  // Every account-defined custom field (Lead Source, RUC, Ciudad, ...),
  // each paired with this contact's current value. Shown inline right
  // alongside Email/Company instead of requiring a trip to the
  // Contacts page's Custom Fields tab — same posture "Lead Source" used
  // to get on its own before this generalized it to the full catalogue.
  const [customFields, setCustomFields] = useState<CustomFieldWithValue[]>([]);

  // Manual stage override for the contact's current deal (the same one
  // the "etapa de negocio" badge above the phone/email block reflects).
  // Before this, that badge was purely automatic — the only way to
  // change a deal's stage was opening the full DealForm sheet via
  // "Ver oportunidad" below. This adds a quick inline picker right
  // under the badge for when a rep just wants to correct the stage
  // without the whole form.
  const statusDealForStages = deals.find((d) => d.status === "open") ?? deals[0] ?? null;
  const [statusDealStages, setStatusDealStages] = useState<PipelineStage[]>([]);
  const [stageUpdating, setStageUpdating] = useState(false);
  useEffect(() => {
    const pipelineId = statusDealForStages?.pipeline_id;
    if (!pipelineId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing stale stages when there's no deal/pipeline to load them for
      setStatusDealStages([]);
      return;
    }
    let cancelled = false;
    const supabase = createClient();
    supabase
      .from("pipeline_stages")
      .select("*")
      .eq("pipeline_id", pipelineId)
      .order("position")
      .then(({ data }) => {
        if (!cancelled) setStatusDealStages(data ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [statusDealForStages?.pipeline_id]);

  const handleStageChange = useCallback(
    async (stageId: string) => {
      if (!statusDealForStages || stageId === statusDealForStages.stage_id) return;
      const nextStage = statusDealStages.find((s) => s.id === stageId);
      if (!nextStage) return;

      setStageUpdating(true);
      const dealId = statusDealForStages.id;
      // Goes through the server (not a direct client update, unlike
      // the other quick-edit fields on this panel) so the move gets
      // logged to ai_activity_events with the acting rep's name —
      // that table has no INSERT policy for authenticated users on
      // purpose (migration 075), only the service-role client can
      // write it. See src/app/api/deals/[id]/stage/route.ts.
      let res: Response;
      try {
        res = await fetch(`/api/deals/${dealId}/stage`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stage_id: stageId }),
        });
      } catch {
        setStageUpdating(false);
        toast.error(tSidebar("stageUpdateError"));
        return;
      }
      setStageUpdating(false);

      if (!res.ok) {
        console.error("Failed to update deal stage:", res.status);
        toast.error(tSidebar("stageUpdateError"));
        return;
      }

      // Optimistic — the on_deal_stage_changed_sync_status trigger
      // (migration 060) may also flip `status` server-side (won/lost
      // stage); re-derive it the same way that trigger does rather
      // than waiting on a refetch, so the badge above updates in the
      // same click.
      const updatedDeals = deals.map((d) =>
        d.id === dealId
          ? {
              ...d,
              stage_id: stageId,
              stage: nextStage,
              status: nextStage.is_won_stage
                ? ("won" as const)
                : nextStage.is_lost_stage
                  ? ("lost" as const)
                  : d.status === "won" || d.status === "lost"
                    ? ("open" as const)
                    : d.status,
            }
          : d,
      );
      setDeals(updatedDeals);
      if (contact) {
        writeViewCache<ContactPanelSnapshot>(contactPanelCacheKey(user?.id, contact.id), {
          deals: updatedDeals,
          tags,
          customFields,
        });
      }
    },
    [statusDealForStages, statusDealStages, deals, tags, customFields, contact, user?.id, tSidebar],
  );

  const saveCustomField = useCallback(
    async (fieldId: string, value: string) => {
      if (!contact) return;
      setCustomFields((prev) =>
        prev.map((cf) => (cf.field.id === fieldId ? { ...cf, value } : cf)),
      );
      const supabase = createClient();
      const { error } = await saveContactCustomFieldValue(supabase, contact.id, fieldId, value);
      if (error) {
        console.error("Failed to update custom field:", error);
        toast.error(tSidebar("saveFieldError"));
      }
    },
    [contact, tSidebar],
  );

  // Deal editing — clicking a deal opens the same DealForm used on the
  // Pipelines board, so value/stage/title/currency/notes are all
  // editable from one proven component instead of a second bespoke
  // "Valor" field that would duplicate deals.value.
  const [dealFormOpen, setDealFormOpen] = useState(false);
  const [editingDeal, setEditingDeal] = useState<Deal | null>(null);
  const [editingDealStages, setEditingDealStages] = useState<PipelineStage[]>([]);

  const handleDealClick = useCallback(async (deal: Deal) => {
    const supabase = createClient();
    const { data } = await supabase
      .from("pipeline_stages")
      .select("*")
      .eq("pipeline_id", deal.pipeline_id)
      .order("position");
    setEditingDealStages(data ?? []);
    setEditingDeal(deal);
    setDealFormOpen(true);
  }, []);

  // AI auto-reply switch — mirrors AiThreadBanner exactly (same shared
  // helpers, same endpoint, same optimistic-then-realtime pattern) so
  // toggling from here or from the chat footer converge on the same
  // `conversations.ai_autoreply_disabled` value. See
  // src/lib/ai/autoreply-toggle.ts.
  const [aiConfigured, setAiConfigured] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiPaused, setAiPaused] = useState(aiAutoreplyDisabled);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAiPaused(aiAutoreplyDisabled);
  }, [conversationId, aiAutoreplyDisabled]);

  useEffect(() => {
    if (!accountId) return;
    let alive = true;
    fetchAiAccountStatus(accountId).then((s) => alive && setAiConfigured(s.autoReplyOn));
    return () => {
      alive = false;
    };
  }, [accountId]);

  const handleAiToggle = useCallback(
    async (paused: boolean) => {
      if (!conversationId) return;
      setAiBusy(true);
      try {
        const result = await toggleAiAutoReply(conversationId, paused);
        if (!result.ok) {
          toast.error(result.error ?? tAiBanner("updateError"));
          return;
        }
        setAiPaused(paused);
        onAiAutoReplyChange?.(conversationId, paused);
        toast.success(paused ? tAiBanner("tookOver") : tAiBanner("resumed"));
      } catch {
        toast.error(tAiBanner("networkError"));
      } finally {
        setAiBusy(false);
      }
    },
    [conversationId, onAiAutoReplyChange, tAiBanner],
  );

  // Seed synchronously whenever the contact changes, BEFORE
  // fetchContactData's async fetch repopulates it — same "set now,
  // the fetch below replaces it" pattern the inbox's message cache
  // uses. Previously this hard-cleared to empty, which meant the
  // PREVIOUS contact's deals/tags/custom fields showed for the length
  // of every fetch — not just a blank flash, actually wrong data
  // displayed under the new contact's name/avatar (which had already
  // updated, straight from the `contact` prop, no fetch). Reading the
  // last-known snapshot for the NEW contact fixes both: no stale-wrong
  // data, and no flash on a contact this session has already loaded.
  /* eslint-disable react-hooks/set-state-in-effect -- seeding per-contact data when the contact changes, before fetchContactData repopulates it */
  useEffect(() => {
    const cached = contact
      ? readViewCache<ContactPanelSnapshot>(contactPanelCacheKey(user?.id, contact.id))
      : undefined;
    setDeals(cached?.deals ?? []);
    setTags(cached?.tags ?? []);
    setCustomFields(cached?.customFields ?? []);
  }, [contact?.id, user?.id]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Guards against a race: fetchContactData is also called manually
  // (DealForm's onSaved, to refresh after an edit) — without this, a
  // slow response for a contact the user has since navigated AWAY from
  // could land after a newer, faster fetch and overwrite the correct
  // data back to a stale/wrong contact's.
  const fetchGenerationRef = useRef(0);

  const fetchContactData = useCallback(async () => {
    if (!contact) return;
    const generation = ++fetchGenerationRef.current;

    const supabase = createClient();

    // Fetch deals, tags, and the account's custom field catalogue
    // (+ this contact's values) in parallel. Notes load themselves
    // inside <ContactNotesPanel>.
    const [dealsRes, tagsRes, customFieldsResult] = await Promise.all([
      supabase
        .from("deals")
        .select("*, stage:pipeline_stages(*)")
        .eq("contact_id", contact.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("contact_tags")
        .select("id, tag_id, tags(*)")
        .eq("contact_id", contact.id),
      fetchContactCustomFields(supabase, contact.id),
    ]);

    if (fetchGenerationRef.current !== generation) return; // superseded by a newer call

    if (dealsRes.data) setDeals(dealsRes.data);
    const mappedTags = tagsRes.data
      ? tagsRes.data
          .filter((ct: Record<string, unknown>) => ct.tags)
          .map((ct: Record<string, unknown>) => ({
            ...(ct.tags as Tag),
            contact_tag_id: ct.id as string,
          }))
      : null;
    if (mappedTags) setTags(mappedTags);
    setCustomFields(customFieldsResult);

    // Cache whatever we just fetched successfully — a null result for
    // one of the three (a transient query error) simply isn't
    // overwritten in the cache, same "don't clobber good data with a
    // failed fetch" posture the state updates above already have.
    const cached = readViewCache<ContactPanelSnapshot>(contactPanelCacheKey(user?.id, contact.id));
    writeViewCache<ContactPanelSnapshot>(contactPanelCacheKey(user?.id, contact.id), {
      deals: dealsRes.data ?? cached?.deals ?? [],
      tags: mappedTags ?? cached?.tags ?? [],
      customFields: customFieldsResult,
    });
  }, [contact, user?.id]);

  // Load on contact change. setDeals/setTags/setCustomFields run inside
  // an async Supabase callback, not synchronously in the effect body.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchContactData();
  }, [fetchContactData]);

  // Live-follow this contact's deals so the stage picker and the
  // Negocios card always show what the AI last wrote (lead-scoring.ts
  // moves deals to "Calificado", sales-actions.ts sets stage/value) —
  // without this they only refreshed on a contact switch, so an AI
  // stage move mid-conversation left the picker showing the old stage.
  // The picker is just a manual editor on top of that same value.
  const contactIdForRealtime = contact?.id;
  useEffect(() => {
    if (!contactIdForRealtime) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`contact-sidebar-deals:${contactIdForRealtime}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "deals",
          filter: `contact_id=eq.${contactIdForRealtime}`,
        },
        () => void fetchContactData(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [contactIdForRealtime, fetchContactData]);

  const handleCopyPhone = useCallback(async () => {
    if (!contact?.phone) return;
    await navigator.clipboard.writeText(contact.phone);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    // Dep is the whole `contact` object (not `contact?.phone`) so the
    // React Compiler's inference agrees with the manual dep list —
    // fixes the `preserve-manual-memoization` lint error.
  }, [contact]);

  // Collapsed — a slim icon rail rather than unmounting, so reopening
  // stays a one-click affordance on the panel itself instead of hunting
  // for a control somewhere else in the thread header.
  if (!open) {
    return (
      <div className="flex h-full w-12 shrink-0 flex-col items-center border-l border-border bg-card pt-3">
        {onToggle && (
          <button
            type="button"
            onClick={onToggle}
            aria-label={tThread("showContactPanel")}
            title={tThread("showContact")}
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <PanelRightOpen className="h-4 w-4" />
          </button>
        )}
      </div>
    );
  }

  // Shared header bar — every expanded state (this "no contact selected"
  // placeholder included) gets the same close control in the same spot.
  const collapseButton = onToggle && (
    <button
      type="button"
      onClick={onToggle}
      aria-label={tThread("hideContactPanel")}
      title={tThread("hideContact")}
      className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <PanelRightClose className="h-4 w-4" />
    </button>
  );

  if (!contact) {
    return (
      <div className="flex h-full w-full flex-col border-l border-border bg-card">
        <div className="flex h-12 shrink-0 items-center justify-end border-b border-border px-2">
          {collapseButton}
        </div>
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-muted-foreground">{tThread("selectConversation")}</p>
        </div>
      </div>
    );
  }

  const displayName = contact.name || contact.phone;
  const initials = displayName.charAt(0).toUpperCase();

  // "Status" badge — the contact's furthest-along deal: prefer an open
  // one (most recent, since `deals` is fetched newest-first) so a
  // stale won/lost deal from months ago doesn't outrank an active
  // negotiation; fall back to the single most recent deal otherwise.
  const statusDeal = deals.find((d) => d.status === "open") ?? deals[0] ?? null;
  const statusLabel =
    statusDeal?.status === "won"
      ? tSidebar("dealWon")
      : statusDeal?.status === "lost"
        ? tSidebar("dealLost")
        : statusDeal?.stage?.name;
  const statusColor =
    statusDeal?.status === "won"
      ? "#22c55e"
      : statusDeal?.status === "lost"
        ? "#ef4444"
        : (statusDeal?.stage?.color ?? "#94a3b8");

  return (
    <div className="flex h-full w-full flex-col border-l border-border bg-card">
      <div className="flex h-12 shrink-0 items-center justify-end border-b border-border px-2">
        {collapseButton}
      </div>
      {/* `min-h-0` is load-bearing: a flex child defaults to
          min-height:auto, so without it this ScrollArea grows to fit
          all its content (contact info, custom fields, deals, notes...)
          instead of shrinking to the remaining space — it then just
          stops scrolling once content exceeds the viewport, same bug
          conversation-list.tsx hit (issue #229). */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-4">
          {/* Contact Info — avatar on the left, name + score/stage
              capsules to its right; everything else stacks below. */}
          <div className="flex items-center gap-3">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-lg font-semibold text-foreground">
              {contact.avatar_url ? (
                <img
                  src={contact.avatar_url}
                  alt={displayName}
                  className="h-14 w-14 rounded-full object-cover"
                />
              ) : (
                initials
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-sm font-semibold text-foreground">
                {displayName}
              </h3>
              <div className="mt-1 flex flex-wrap items-center gap-1">
                <LeadScoreBadge
                  score={scoreOverride?.score ?? contact.lead_score}
                  reason={scoreOverride ? scoreOverride.reason : contact.lead_score_reason}
                  updatedAt={contact.lead_score_updated_at}
                  editable
                  contactId={contact.id}
                  onScoreChange={setScoreOverride}
                />
                {statusLabel && (
                  <span
                    className="inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                    style={{ backgroundColor: `${statusColor}20`, color: statusColor }}
                  >
                    {statusLabel}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* AI summary + suggested next step — the executive-summary
              slice of the same profile Contacts → "Resumen" shows in
              full (useLeadSummary, shared). Right under the identity
              block, before the editable fields, so it reads as "here's
              what's going on" before "here's what we know about them". */}
          {contact && (
            <div className="mt-4">
              <LeadSummaryCompact contact={contact} />
            </div>
          )}

          {/* Phone / Email / Company */}
          <div className="mt-4 space-y-2">
            <button
              onClick={handleCopyPhone}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted"
            >
              <Phone className="h-4 w-4 text-muted-foreground" />
              <span className="flex-1 text-left">{contact.phone}</span>
              {copied ? (
                <Check className="h-3 w-3 text-primary" />
              ) : (
                <Copy className="h-3 w-3 text-muted-foreground" />
              )}
            </button>

            <div className="flex items-center gap-2 rounded-lg px-3 py-1.5">
              <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
              <Input
                key={`email-${contact.id}`}
                type="email"
                defaultValue={emailDraft}
                placeholder={tSidebar("emailPlaceholder")}
                onBlur={(e) => {
                  const value = e.target.value;
                  setEmailDraft(value);
                  saveContactField("email", value, contact.email);
                }}
                className="h-7 flex-1 border-transparent bg-transparent px-1.5 text-sm text-foreground placeholder:text-muted-foreground hover:border-border focus:border-primary/50 focus:bg-muted"
              />
            </div>

            <div className="flex items-center gap-2 rounded-lg px-3 py-1.5">
              <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
              <Input
                key={`company-${contact.id}`}
                type="text"
                defaultValue={companyDraft}
                placeholder={tSidebar("companyPlaceholder")}
                onBlur={(e) => {
                  const value = e.target.value;
                  setCompanyDraft(value);
                  saveContactField("company", value, contact.company);
                }}
                className="h-7 flex-1 border-transparent bg-transparent px-1.5 text-sm text-foreground placeholder:text-muted-foreground hover:border-border focus:border-primary/50 focus:bg-muted"
              />
            </div>

            {/* Every account-defined custom field (RUC, Ciudad, Lead
                Source, ...) — same inline-edit treatment as Email/Company
                above, so agents never have to leave the conversation to
                see or fill these in. */}
            {customFields.map(({ field, value }) =>
              field.field_type === "select" ? (
                <div key={field.id} className="flex items-center gap-2 rounded-lg px-3 py-1.5">
                  <SlidersHorizontal className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <Select
                    value={value || undefined}
                    onValueChange={(v) => saveCustomField(field.id, v ?? "")}
                  >
                    <SelectTrigger className="h-7 flex-1 border-transparent bg-transparent text-sm text-foreground hover:border-border">
                      <SelectValue placeholder={field.field_name} />
                    </SelectTrigger>
                    <SelectContent>
                      {(field.field_options?.options ?? []).map((opt) => (
                        <SelectItem key={opt} value={opt}>
                          {opt}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div key={field.id} className="flex items-center gap-2 rounded-lg px-3 py-1.5">
                  <SlidersHorizontal className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <Input
                    key={`${field.id}-${contact.id}`}
                    type="text"
                    defaultValue={value}
                    placeholder={tSidebar("customFieldPlaceholder", { name: field.field_name })}
                    onBlur={(e) => {
                      const next = e.target.value;
                      if (next.trim() !== value.trim()) saveCustomField(field.id, next);
                    }}
                    className="h-7 flex-1 border-transparent bg-transparent px-1.5 text-sm text-foreground placeholder:text-muted-foreground hover:border-border focus:border-primary/50 focus:bg-muted"
                  />
                </div>
              ),
            )}
          </div>

          {/* Negocios — the deal(s) and the value the AI collects,
              right under the contact fields (Lead Source etc.). Click
              one to open the full DealForm to edit value/title/etc. */}
          <div className="mt-4">
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <DollarSign className="h-3 w-3" />
              {tSidebar("deals")}
            </div>
            <div className="mt-2 space-y-2">
              {deals.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">{tSidebar("noDeals")}</p>
              ) : (
                deals.map((deal) => (
                  <button
                    key={deal.id}
                    type="button"
                    onClick={() => handleDealClick(deal)}
                    className="w-full rounded-lg bg-muted px-3 py-2 text-left transition-colors hover:bg-muted/70"
                  >
                    <p className="text-sm font-medium text-foreground">
                      {deal.title}
                    </p>
                    <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                      <span>
                        {deal.currency ?? "$"}
                        {deal.value.toLocaleString()}
                      </span>
                      {deal.stage && (
                        <span
                          className="rounded-full px-1.5 py-0.5 text-[10px]"
                          style={{
                            backgroundColor: `${deal.stage.color}20`,
                            color: deal.stage.color,
                          }}
                        >
                          {deal.stage.name}
                        </span>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Deal stage — mirrors whatever the AI last set on the deal
              (kept live by the realtime subscription above); picking a
              value here is only a manual correction on top of that. */}
          {statusDealForStages && statusDealStages.length > 0 && (
            <div className="mt-2">
              <div className="flex items-center gap-2 rounded-lg px-3 py-1.5">
                <Layers className="h-4 w-4 shrink-0 text-muted-foreground" />
                <Select
                  value={statusDealForStages.stage_id}
                  onValueChange={(v) => v && void handleStageChange(v)}
                  disabled={stageUpdating}
                >
                  <SelectTrigger className="h-7 flex-1 border-transparent bg-transparent text-sm text-foreground hover:border-border">
                    <SelectValue placeholder={tSidebar("stageLabel")} />
                  </SelectTrigger>
                  <SelectContent>
                    {statusDealStages.map((stage) => (
                      <SelectItem key={stage.id} value={stage.id}>
                        <span className="flex items-center gap-1.5">
                          <span
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ backgroundColor: stage.color }}
                          />
                          {stage.name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {/* AI Assistant — right under the stage picker, above Media,
              so pause/resume is reachable without scrolling. */}
          {conversationId && aiConfigured && (
            <>
              {/* Divider */}
              <div className="my-4 border-t border-border" />

              <div className="flex items-center justify-between gap-2 px-1">
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  <Sparkles className="h-3 w-3" />
                  {tSidebar("aiAssistant")}
                </div>
                <Switch
                  checked={!aiPaused}
                  onCheckedChange={(checked) => handleAiToggle(!checked)}
                  disabled={aiBusy}
                  aria-label={tSidebar("aiAssistant")}
                />
              </div>
              <p className="mt-1 px-1 text-xs text-muted-foreground">
                {aiPaused
                  ? assignedAgentId
                    ? tSidebar("aiOwnedByAgent")
                    : tAiBanner("pausedTitle")
                  : tAiBanner("activeText")}
              </p>
            </>
          )}

          {/* Media tray — every photo/video from this conversation, newest
              first. Same lightbox the message bubbles open, so a thumbnail
              here pages through the exact same set ← / →. */}
          {mediaGalleryNewestFirst.length > 0 && (
            <>
              {/* Divider */}
              <div className="my-4 border-t border-border" />

              <div>
                <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  <Images className="h-3 w-3" />
                  {tSidebar("media")}
                  <span className="text-muted-foreground/70">
                    {mediaGalleryNewestFirst.length}
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-4 gap-1.5">
                  {mediaGalleryNewestFirst.map((item) => (
                    <button
                      key={item.messageId}
                      type="button"
                      onClick={() => setOpenMediaId(item.messageId)}
                      className="group relative aspect-square overflow-hidden rounded-md bg-muted"
                    >
                      {item.kind === "video" ? (
                        <>
                          <video
                            src={item.url}
                            className="h-full w-full object-cover"
                            muted
                            playsInline
                            preload="metadata"
                          />
                          <span className="absolute inset-0 flex items-center justify-center bg-black/20 transition-colors group-hover:bg-black/35">
                            <PlayCircle className="h-5 w-5 text-white drop-shadow" />
                          </span>
                        </>
                      ) : (
                        <img
                          src={item.url}
                          alt={item.caption || ""}
                          loading="lazy"
                          className="h-full w-full object-cover transition-transform group-hover:scale-105"
                        />
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Tags */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <TagIcon className="h-3 w-3" />
              {tSidebar("tags")}
              <InfoTooltip title={tSidebar("tagsInfoTitle")}>{tSidebar("tagsInfoBody")}</InfoTooltip>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {tags.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">{tSidebar("noTags")}</p>
              ) : (
                tags.map((tag) => (
                  <span
                    key={tag.contact_tag_id}
                    className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                    style={{
                      backgroundColor: `${tag.color}20`,
                      color: tag.color,
                    }}
                  >
                    {tag.name}
                  </span>
                ))
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Notes */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <StickyNote className="h-3 w-3" />
              {tSidebar("notes")}
              <InfoTooltip title={tSidebar("notesInfoTitle")}>{tSidebar("notesInfoBody")}</InfoTooltip>
            </div>
            <div className="mt-2">
              {contact && (
                <ContactNotesPanel
                  contactId={contact.id}
                  conversationId={conversationId}
                  compact
                />
              )}
            </div>
          </div>

        </div>
      </ScrollArea>

      <DealForm
        open={dealFormOpen}
        onOpenChange={setDealFormOpen}
        deal={editingDeal}
        pipelineId={editingDeal?.pipeline_id ?? ""}
        stages={editingDealStages}
        defaultStageId={editingDeal?.stage_id}
        onSaved={fetchContactData}
      />

      <MediaLightbox
        items={mediaGallery}
        activeId={openMediaId}
        onActiveIdChange={setOpenMediaId}
        contactLabel={displayName}
      />
    </div>
  );
}
