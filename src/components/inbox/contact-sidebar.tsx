"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import type { Contact, Deal, ContactNote, Tag, PipelineStage } from "@/types";
import {
  Phone,
  Mail,
  Copy,
  Check,
  Tag as TagIcon,
  DollarSign,
  StickyNote,
  Plus,
  Building2,
  Sparkles,
  Compass,
  PanelRightOpen,
  PanelRightClose,
} from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { format } from "date-fns";
import { useTranslations } from "next-intl";
import { fetchAiAccountStatus, toggleAiAutoReply } from "@/lib/ai/autoreply-toggle";
import { LEAD_SOURCE_FIELD_NAME } from "@/lib/contacts/lead-source";
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
}

export function ContactSidebar({
  contact,
  conversationId,
  aiAutoreplyDisabled = false,
  assignedAgentId,
  onAiAutoReplyChange,
  open = true,
  onToggle,
}: ContactSidebarProps) {
  const tSidebar = useTranslations("Inbox.sidebar");
  const tThread = useTranslations("Inbox.messageThread");
  const tAiBanner = useTranslations("Inbox.aiBanner");

  const { accountId } = useAuth();
  const [copied, setCopied] = useState(false);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [tags, setTags] = useState<(Tag & { contact_tag_id: string })[]>([]);
  const [newNote, setNewNote] = useState("");
  const [addingNote, setAddingNote] = useState(false);

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

  // "Lead Source" — same custom_fields system as any other custom
  // field, surfaced here (like Email/Company) because it's the one
  // account-config-independent field product wants visible without
  // digging into the Custom Fields tab. Hidden entirely when the
  // account has no "Lead Source" field yet (see fetchContactData).
  const [leadSourceFieldId, setLeadSourceFieldId] = useState<string | null>(null);
  const [leadSourceOptions, setLeadSourceOptions] = useState<string[]>([]);
  const [leadSourceValue, setLeadSourceValue] = useState("");

  const saveLeadSource = useCallback(
    async (value: string) => {
      if (!contact || !leadSourceFieldId) return;
      setLeadSourceValue(value);
      const supabase = createClient();
      const { error } = await supabase.from("contact_custom_values").upsert(
        { contact_id: contact.id, custom_field_id: leadSourceFieldId, value },
        { onConflict: "contact_id,custom_field_id" },
      );
      if (error) {
        console.error("Failed to update lead source:", error.message);
        toast.error(tSidebar("saveFieldError"));
      }
    },
    [contact, leadSourceFieldId, tSidebar],
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

  const fetchContactData = useCallback(async () => {
    if (!contact) return;

    const supabase = createClient();

    // Fetch deals, notes, tags, and the "Lead Source" field definition
    // in parallel.
    const [dealsRes, notesRes, tagsRes, leadSourceFieldRes] = await Promise.all([
      supabase
        .from("deals")
        .select("*, stage:pipeline_stages(*)")
        .eq("contact_id", contact.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("contact_notes")
        .select("*")
        .eq("contact_id", contact.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("contact_tags")
        .select("id, tag_id, tags(*)")
        .eq("contact_id", contact.id),
      supabase
        .from("custom_fields")
        .select("id, field_options")
        .eq("field_name", LEAD_SOURCE_FIELD_NAME)
        .maybeSingle(),
    ]);

    if (dealsRes.data) setDeals(dealsRes.data);
    if (notesRes.data) setNotes(notesRes.data);
    if (tagsRes.data) {
      const mapped = tagsRes.data
        .filter((ct: Record<string, unknown>) => ct.tags)
        .map((ct: Record<string, unknown>) => ({
          ...(ct.tags as Tag),
          contact_tag_id: ct.id as string,
        }));
      setTags(mapped);
    }

    // "Lead Source" is opt-in — the field only exists once a referral-
    // sourced contact came in, or an admin created it manually. Hide
    // the control entirely when it doesn't exist yet, same posture as
    // any other custom field.
    const leadSourceField = leadSourceFieldRes.data;
    if (leadSourceField) {
      setLeadSourceFieldId(leadSourceField.id);
      setLeadSourceOptions(leadSourceField.field_options?.options ?? []);
      const { data: valueRow } = await supabase
        .from("contact_custom_values")
        .select("value")
        .eq("contact_id", contact.id)
        .eq("custom_field_id", leadSourceField.id)
        .maybeSingle();
      setLeadSourceValue(valueRow?.value ?? "");
    } else {
      setLeadSourceFieldId(null);
      setLeadSourceOptions([]);
      setLeadSourceValue("");
    }
  }, [contact]);

  // Load on contact change. setContactData/setTags run inside async
  // Supabase callbacks, not synchronously in the effect body.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchContactData();
  }, [fetchContactData]);

  const handleCopyPhone = useCallback(async () => {
    if (!contact?.phone) return;
    await navigator.clipboard.writeText(contact.phone);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    // Dep is the whole `contact` object (not `contact?.phone`) so the
    // React Compiler's inference agrees with the manual dep list —
    // fixes the `preserve-manual-memoization` lint error.
  }, [contact]);

  const handleAddNote = useCallback(async () => {
    if (!contact || !newNote.trim()) return;
    if (!accountId) return;
    setAddingNote(true);

    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const sessionUser = session?.user;

    const { data, error } = await supabase
      .from("contact_notes")
      .insert({
        contact_id: contact.id,
        account_id: accountId,
        user_id: sessionUser?.id,
        note_text: newNote.trim(),
      })
      .select()
      .single();

    if (!error && data) {
      setNotes((prev) => [data, ...prev]);
      setNewNote("");
    }
    setAddingNote(false);
  }, [contact, newNote, accountId]);

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
      <div className="flex h-full w-70 flex-col border-l border-border bg-card">
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
    <div className="flex h-full w-70 flex-col border-l border-border bg-card">
      <div className="flex h-12 shrink-0 items-center justify-end border-b border-border px-2">
        {collapseButton}
      </div>
      <ScrollArea className="flex-1">
        <div className="p-4">
          {/* Contact Info */}
          <div className="flex flex-col items-center text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted text-lg font-semibold text-foreground">
              {contact.avatar_url ? (
                <img
                  src={contact.avatar_url}
                  alt={displayName}
                  className="h-16 w-16 rounded-full object-cover"
                />
              ) : (
                initials
              )}
            </div>
            <h3 className="mt-3 text-sm font-semibold text-foreground">
              {displayName}
            </h3>
            <div className="mt-1.5 flex flex-wrap items-center justify-center gap-1">
              <LeadScoreBadge score={contact.lead_score} />
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

            {leadSourceFieldId && (
              <div className="flex items-center gap-2 rounded-lg px-3 py-1.5">
                <Compass className="h-4 w-4 shrink-0 text-muted-foreground" />
                <Select
                  value={leadSourceValue || undefined}
                  onValueChange={(v) => saveLeadSource(v ?? "")}
                >
                  <SelectTrigger className="h-7 flex-1 border-transparent bg-transparent text-sm text-foreground hover:border-border">
                    <SelectValue placeholder={tSidebar("leadSourcePlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {leadSourceOptions.map((opt) => (
                      <SelectItem key={opt} value={opt}>
                        {opt}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* AI Assistant */}
          {conversationId && aiConfigured && (
            <>
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

              {/* Divider */}
              <div className="my-4 border-t border-border" />
            </>
          )}

          {/* Tags */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <TagIcon className="h-3 w-3" />
              {tSidebar("tags")}
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

          {/* Active Deals */}
          <div>
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

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Notes */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <StickyNote className="h-3 w-3" />
              {tSidebar("notes")}
            </div>
            <div className="mt-2">
              <div className="flex gap-2">
                <textarea
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder={tSidebar("addNotePlaceholder")}
                  rows={2}
                  className="flex-1 resize-none rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground placeholder-muted-foreground outline-none focus:border-primary/50"
                />
                <Button
                  size="sm"
                  className="h-auto bg-primary px-2 hover:bg-primary/90"
                  onClick={handleAddNote}
                  disabled={!newNote.trim() || addingNote}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>

              <div className="mt-2 space-y-2">
                {notes.map((note) => (
                  <div
                    key={note.id}
                    className="rounded-lg bg-muted px-3 py-2"
                  >
                    <p className="whitespace-pre-wrap text-xs text-muted-foreground">
                      {note.note_text}
                    </p>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {format(new Date(note.created_at), "MMM d, yyyy HH:mm")}
                    </p>
                  </div>
                ))}
              </div>
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
    </div>
  );
}
