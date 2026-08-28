"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  CONVERSATION_SELECT,
  matchesContactFilters,
  normalizeConversations,
} from "@/lib/inbox/conversations";
import { cn } from "@/lib/utils";
import type { Conversation, ConversationStatus, Tag } from "@/types";
import { Search, ChevronDown, X, Inbox, MessageCircle, Camera } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { LeadScoreBadge, LEAD_SCORE_STYLES, type Score } from "@/components/leads/lead-score-badge";
import { PlatformIcon, AvatarRing } from "./platform-accent";
import {
  getConversationPlatform,
  platformSoftBackground,
  WHATSAPP_TINT,
  INSTAGRAM_GRADIENT,
  type ConversationPlatform,
} from "@/lib/inbox/platform";

interface ConversationListProps {
  activeConversationId: string | null;
  onSelect: (conversation: Conversation) => void;
  conversations: Conversation[];
  onConversationsLoaded: (conversations: Conversation[]) => void;
  /**
   * Increment to force the fetch effect below to refire. The parent
   * bumps this on realtime reconnect / tab visibility → visible so the
   * list catches up on any events sent while the WS was disconnected
   * or the tab was throttled. Optional so existing callers keep working.
   */
  resyncToken?: number;
}

const STATUS_COLORS: Record<ConversationStatus, string> = {
  open: "bg-primary",
  pending: "bg-amber-500",
  closed: "bg-muted-foreground",
};



type InboxFilter = ConversationStatus | "all" | "unread";
type PlatformFilter = ConversationPlatform | "all";
type LeadScoreFilter = Score | "unscored" | "all";

// Session-only (not localStorage) per the platform filter's own persistence
// scope — it should survive navigating around the inbox but not outlive the
// browsing session, unlike the contact-panel open/closed preference.
const PLATFORM_FILTER_STORAGE_KEY = "saleslid:inbox:platform-filter";
const LEAD_SCORE_FILTER_STORAGE_KEY = "saleslid:inbox:lead-score-filter";

const PLATFORM_TAB_ORDER: PlatformFilter[] = ["whatsapp", "instagram", "all"];
// Hottest first — a salesperson opening the inbox should see HOT leads
// as the leftmost, most natural first click.
const LEAD_SCORE_TAB_ORDER: LeadScoreFilter[] = ["hot", "warm", "cold", "unscored", "all"];

// How long after a customer's message we still consider the AI
// "actively analyzing" this conversation, if the score hasn't caught
// up with it yet. There's no real backend "in progress" flag — this
// is a client-side inference (recent message + stale score), so the
// window is capped rather than left open-ended: an account with no
// qualification criteria configured, a rate-limited turn, or a
// no-verdict response would otherwise show this indicator forever
// instead of it quietly clearing.
const ANALYZING_WINDOW_MS = 20_000;

/** True when the AI is plausibly still scoring this turn — a message
 *  landed within the last `ANALYZING_WINDOW_MS` and the contact's
 *  score hasn't been (re)assessed since. Only meaningful for accounts
 *  that actually have qualification criteria configured; otherwise
 *  scoring never runs at all and this always reads false. */
function isAnalyzing(conv: Conversation, hasCriteria: boolean, now: number): boolean {
  if (!hasCriteria || !conv.last_message_at) return false;
  const lastMessageAt = new Date(conv.last_message_at).getTime();
  if (now - lastMessageAt > ANALYZING_WINDOW_MS) return false;
  const assessedAt = conv.contact?.lead_score_assessed_at;
  return !assessedAt || new Date(assessedAt).getTime() < lastMessageAt;
}

// Trims the AI's reason down to a short, row-friendly snippet — the
// stored text is a full short phrase (the model is told to keep it
// under 20 words), fine for a tooltip or the contact detail view, but
// too much to sit permanently on every inbox row. Cuts at a word
// boundary rather than a hard character count so it never ends
// mid-word. The full text is still what's stored and shown everywhere
// else (contact detail, score history) — this is a display-only trim
// for this one dense, always-visible context.
const ROW_REASON_MAX_CHARS = 24;
function shortenReason(reason: string): string {
  const trimmed = reason.trim();
  if (trimmed.length <= ROW_REASON_MAX_CHARS) return trimmed;
  const cut = trimmed.slice(0, ROW_REASON_MAX_CHARS);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 10 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

export function ConversationList({
  activeConversationId,
  onSelect,
  conversations,
  onConversationsLoaded,
  resyncToken = 0,
}: ConversationListProps) {
  const t = useTranslations("Inbox.conversationList");
  const tLeads = useTranslations("Leads");

  const FILTER_OPTIONS: { label: string; value: InboxFilter }[] = useMemo(() => [
    { label: t("filterAll"), value: "all" },
    { label: t("filterUnread"), value: "unread" },
    { label: t("filterOpen"), value: "open" },
    { label: t("filterPending"), value: "pending" },
    { label: t("filterClosed"), value: "closed" },
  ], [t]);

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [loading, setLoading] = useState(true);

  // Whether this account has qualification criteria configured at all
  // (migration 038) — scoring only ever runs when it does, so the
  // "AI analyzing" header subtitle and per-row indicator stay
  // completely quiet otherwise instead of implying activity that isn't
  // happening. RLS on ai_configs explicitly allows any account member
  // (viewer+) to read this, unlike the admin-gated /api/ai/config
  // route used by the Settings form — queried directly here for that
  // reason, not through that route.
  const [hasQualificationCriteria, setHasQualificationCriteria] = useState(false);
  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("ai_configs")
        .select("qualification_criteria")
        .maybeSingle();
      if (!cancelled) setHasQualificationCriteria(!!data?.qualification_criteria?.trim());
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Ticks so the "analyzing" window (see `isAnalyzing` above) actually
  // expires on its own even with no new realtime events to trigger a
  // re-render — e.g. a turn that never gets a verdict (no criteria hit,
  // rate-limited, model returned null).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 3000);
    return () => clearInterval(id);
  }, []);
  // Platform tab (WhatsApp / Instagram / Todas). Session-scoped — restored
  // from sessionStorage after mount (not read in the initializer, so SSR
  // and first client render agree and there's no hydration mismatch).
  const [platformFilter, setPlatformFilter] = useState<PlatformFilter>("all");
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(PLATFORM_FILTER_STORAGE_KEY);
      if (stored === "all" || stored === "whatsapp" || stored === "instagram") {
        setPlatformFilter(stored);
      }
    } catch {
      // sessionStorage can throw in private-browsing / sandboxed contexts.
    }
  }, []);
  const handlePlatformFilterChange = useCallback((value: PlatformFilter) => {
    setPlatformFilter(value);
    try {
      sessionStorage.setItem(PLATFORM_FILTER_STORAGE_KEY, value);
    } catch {
      // Persistence is best-effort; ignore storage failures.
    }
  }, []);
  // Lead-score tab (Hot / Warm / Cold / Not scored / All) — same
  // session-scoped restore-after-mount pattern as the platform tab above.
  const [leadScoreFilter, setLeadScoreFilter] = useState<LeadScoreFilter>("all");
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(LEAD_SCORE_FILTER_STORAGE_KEY);
      if (stored && (LEAD_SCORE_TAB_ORDER as string[]).includes(stored)) {
        setLeadScoreFilter(stored as LeadScoreFilter);
      }
    } catch {
      // sessionStorage can throw in private-browsing / sandboxed contexts.
    }
  }, []);
  const handleLeadScoreFilterChange = useCallback((value: LeadScoreFilter) => {
    setLeadScoreFilter(value);
    try {
      sessionStorage.setItem(LEAD_SCORE_FILTER_STORAGE_KEY, value);
    } catch {
      // Persistence is best-effort; ignore storage failures.
    }
  }, []);
  // Contact-based filters (issue #272). Tags use OR logic (a conversation
  // matches if its contact carries any selected tag), consistent with
  // Broadcast audience filtering. Company is an exact match on the field.
  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);

  // Keep the latest callback in a ref so the fetch effect below can
  // have a stable, empty-dep identity. Previously the fetch useCallback
  // depended on `onConversationsLoaded`, which depends on the parent's
  // `deepLinkConvId` — so every URL change (including one the parent
  // triggered via router.replace after a click) caused a fresh
  // conversations fetch. That extra refetch was the trigger for the
  // deep-link auto-select running a second time and wiping the active
  // thread's messages.
  // Mutation lives in an effect (not render) per React 19's refs rule;
  // the fetch runs once on mount so it's fine to read the slightly
  // older value — the very next render updates the ref for any
  // subsequent async completion.
  const onConversationsLoadedRef = useRef(onConversationsLoaded);
  useEffect(() => {
    onConversationsLoadedRef.current = onConversationsLoaded;
  });

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from("conversations")
        .select(CONVERSATION_SELECT)
        .order("last_message_at", { ascending: false });

      if (cancelled) return;

      if (error) {
        // Supabase errors have non-enumerable properties — log fields explicitly
        console.error("Failed to fetch conversations:", {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        setLoading(false);
        return;
      }

      onConversationsLoadedRef.current(normalizeConversations(data ?? []));
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
    // `resyncToken` is included so the parent can force a refetch when
    // the realtime channel reconnects or the tab regains focus — catches
    // up on any events sent while the WS was disconnected or throttled.
  }, [resyncToken]);

  // Tag definitions for the filter picker — loaded once so labels/colours
  // stay stable regardless of which conversations happen to be loaded.
  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("tags").select("*").order("name");
      if (!cancelled && data) setTags(data as Tag[]);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Company options are derived from the loaded conversations — there's no
  // separate companies table, and only companies with a live conversation
  // are worth offering as an inbox filter.
  const companies = useMemo(() => {
    const set = new Set<string>();
    for (const c of conversations) {
      const co = c.contact?.company?.trim();
      if (co) set.add(co);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [conversations]);

  const tagsById = useMemo(() => {
    const m = new Map<string, Tag>();
    for (const t of tags) m.set(t.id, t);
    return m;
  }, [tags]);

  // Everything except the lead-score tab itself — this is what the
  // per-tab counts are computed against, so "HOT (12)" means "12 within
  // your other active filters", not 12 out of the whole inbox.
  const preLeadScoreFiltered = useMemo(() => {
    let result = conversations;

    if (platformFilter !== "all") {
      result = result.filter(
        (c) => getConversationPlatform(c) === platformFilter,
      );
    }

    if (filter === "unread") {
      result = result.filter((c) => c.unread_count > 0);
    } else if (filter !== "all") {
      result = result.filter((c) => c.status === filter);
    }

    // Contact-based filters (tags via OR logic, exact company match).
    if (selectedTagIds.length > 0 || selectedCompany !== null) {
      result = result.filter((c) =>
        matchesContactFilters(c, {
          tagIds: selectedTagIds,
          company: selectedCompany,
        })
      );
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((c) => {
        const name = c.contact?.name?.toLowerCase() ?? "";
        const phone = c.contact?.phone?.toLowerCase() ?? "";
        const lastMsg = c.last_message_text?.toLowerCase() ?? "";
        return name.includes(q) || phone.includes(q) || lastMsg.includes(q);
      });
    }

    return result;
  }, [conversations, platformFilter, filter, search, selectedTagIds, selectedCompany]);

  // One conversation per contact's `lead_score` — a contact with several
  // conversations (e.g. WhatsApp + Instagram) always lands in the same
  // bucket in both, since the score belongs to the contact, not the thread.
  const leadScoreCounts = useMemo(() => {
    const counts: Record<LeadScoreFilter, number> = {
      hot: 0,
      warm: 0,
      cold: 0,
      unscored: 0,
      all: preLeadScoreFiltered.length,
    };
    for (const c of preLeadScoreFiltered) {
      const score = c.contact?.lead_score;
      if (score === "hot" || score === "warm" || score === "cold") {
        counts[score]++;
      } else {
        counts.unscored++;
      }
    }
    return counts;
  }, [preLeadScoreFiltered]);

  const filtered = useMemo(() => {
    if (leadScoreFilter === "all") return preLeadScoreFiltered;
    if (leadScoreFilter === "unscored") {
      return preLeadScoreFiltered.filter((c) => !c.contact?.lead_score);
    }
    return preLeadScoreFiltered.filter((c) => c.contact?.lead_score === leadScoreFilter);
  }, [preLeadScoreFiltered, leadScoreFilter]);

  const toggleTag = useCallback((id: string) => {
    setSelectedTagIds((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    );
  }, []);

  const clearContactFilters = useCallback(() => {
    setSelectedTagIds([]);
    setSelectedCompany(null);
  }, []);

  const hasContactFilters = selectedTagIds.length > 0 || selectedCompany !== null;

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearch(e.target.value);
    },
    []
  );

  const handleSelect = useCallback(
    (conv: Conversation) => {
      onSelect(conv);
    },
    [onSelect]
  );

  const activeFilter = FILTER_OPTIONS.find((o) => o.value === filter);

  // Total unread across the whole account (not just the current tab/
  // filter) for the header badge — derived straight from
  // `conversations`, which already carries everything realtime keeps
  // fresh, so it needs no query of its own.
  const unreadTotal = useMemo(
    () => conversations.reduce((sum, c) => sum + (c.unread_count > 0 ? 1 : 0), 0),
    [conversations],
  );

  return (
    // w-full on mobile so the list occupies the whole viewport when it's
    // the single pane showing; fixed 320px on desktop where it shares the
    // row with the thread + contact sidebar.
    <div className="relative flex h-full w-full flex-col border-r border-border bg-card">
      {/* Live header — a pulsing dot signals "connected, actively
          working" instead of a static title. The subtitle is honest
          about whether AI qualification is actually running for this
          account (it only ever does when qualification criteria is
          configured — see the ai_configs fetch above), rather than
          always claiming activity that might not be happening. */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            <h2 className="truncate text-sm font-semibold text-foreground">{t("liveTitle")}</h2>
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {hasQualificationCriteria ? t("liveSubtitleAi") : t("liveSubtitlePlain")}
          </p>
        </div>
        {unreadTotal > 0 && (
          <span className="flex shrink-0 items-center justify-center rounded-full bg-primary px-2.5 py-1 text-xs font-bold text-primary-foreground shadow-sm">
            {t("newCount", { count: unreadTotal })}
          </span>
        )}
      </div>

      {/* Platform tabs — WhatsApp / Instagram / Todas as a filled pill
          segmented control. The active pill is solid-filled with that
          platform's own accent (Instagram's gradient, WhatsApp's green);
          "Todas" fills with the app's theme primary since it isn't
          platform-specific. Inactive pills sit on a flat muted fill so
          the active one reads clearly as "selected", not just underlined. */}
      <div className="flex items-center gap-1.5 border-b border-border px-3 py-2.5">
        {PLATFORM_TAB_ORDER.map((tab) => {
          const isActive = platformFilter === tab;
          const label =
            tab === "whatsapp"
              ? t("platformWhatsapp")
              : tab === "instagram"
                ? t("platformInstagram")
                : t("platformAll");
          const Icon = tab === "whatsapp" ? MessageCircle : tab === "instagram" ? Camera : Inbox;
          return (
            <button
              key={tab}
              type="button"
              onClick={() => handlePlatformFilterChange(tab)}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-all",
                isActive
                  ? "text-white shadow-sm"
                  : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
              style={
                isActive
                  ? {
                      backgroundColor: tab === "whatsapp" ? WHATSAPP_TINT : undefined,
                      backgroundImage: tab === "instagram" ? INSTAGRAM_GRADIENT : undefined,
                      ...(tab === "all"
                        ? { backgroundColor: "var(--primary)", color: "var(--primary-foreground)" }
                        : null),
                    }
                  : undefined
              }
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          );
        })}
      </div>

      {/* Lead-score tabs — Hot / Warm / Cold / Not scored / All, hottest
          first. Counts are scoped to whatever the platform/status/tag/
          company/search filters above already narrowed down to, so the
          numbers stay internally consistent with each other.
          Single row, no wrap: `shrink-0` on every pill plus horizontal
          scroll (scrollbar hidden — this is a compact tab strip, not a
          scroll area anyone needs a visible track for) instead of
          letting it fall to a second line at narrower widths. */}
      <div className="flex items-center gap-1 overflow-x-auto border-b border-border px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {LEAD_SCORE_TAB_ORDER.map((tab) => {
          const isActive = leadScoreFilter === tab;
          const count = leadScoreCounts[tab];
          if (tab === "all" || tab === "unscored") {
            const label = tab === "all" ? t("platformAll") : tLeads("unscored");
            return (
              <button
                key={tab}
                type="button"
                onClick={() => handleLeadScoreFilterChange(tab)}
                className={cn(
                  "flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold transition-all",
                  isActive
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {label}
                <span className={cn("tabular-nums", !isActive && "opacity-60")}>{count}</span>
              </button>
            );
          }
          const { icon: Icon, className: scoreClassName } = LEAD_SCORE_STYLES[tab];
          return (
            <button
              key={tab}
              type="button"
              onClick={() => handleLeadScoreFilterChange(tab)}
              className={cn(
                "flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold ring-1 ring-transparent transition-all",
                isActive ? scoreClassName : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground",
                isActive && "ring-current",
              )}
            >
              <Icon className="h-3 w-3" />
              {tLeads(tab)}
              <span className={cn("tabular-nums", !isActive && "opacity-60")}>{count}</span>
            </button>
          );
        })}
      </div>

      {/* Search + Filter */}
      <div className="space-y-2 border-b border-border p-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={handleSearchChange}
            placeholder={t("searchPlaceholder")}
            className="border-border bg-muted pl-9 text-sm text-foreground placeholder-muted-foreground focus:border-primary/50"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex items-center justify-center h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground rounded-md hover:bg-muted">
                {activeFilter?.label ?? t("filterAll")}
                <ChevronDown className="h-3 w-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="border-border bg-popover"
            >
              {FILTER_OPTIONS.map((opt) => (
                <DropdownMenuItem
                  key={opt.value}
                  onClick={() => setFilter(opt.value)}
                  className={cn(
                    "text-sm",
                    filter === opt.value
                      ? "text-primary"
                      : "text-popover-foreground"
                  )}
                >
                  {opt.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {tags.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger
                className={cn(
                  "inline-flex items-center justify-center h-7 gap-1 px-2 text-xs rounded-md hover:bg-muted",
                  selectedTagIds.length > 0
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {t("tags")}
                {selectedTagIds.length > 0 && (
                  <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                    {selectedTagIds.length}
                  </span>
                )}
                <ChevronDown className="h-3 w-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="max-h-64 w-56 border-border bg-popover"
              >
                {tags.map((t) => (
                  <DropdownMenuCheckboxItem
                    key={t.id}
                    checked={selectedTagIds.includes(t.id)}
                    onCheckedChange={() => toggleTag(t.id)}
                    className="text-sm text-popover-foreground"
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: t.color }}
                      />
                      <span className="truncate">{t.name}</span>
                    </span>
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {companies.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger
                className={cn(
                  "inline-flex max-w-40 items-center justify-center h-7 gap-1 px-2 text-xs rounded-md hover:bg-muted",
                  selectedCompany
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <span className="truncate">{selectedCompany ?? t("company")}</span>
                <ChevronDown className="h-3 w-3 shrink-0" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="max-h-64 w-56 border-border bg-popover"
              >
                <DropdownMenuItem
                  onClick={() => setSelectedCompany(null)}
                  className={cn(
                    "text-sm",
                    selectedCompany === null
                      ? "text-primary"
                      : "text-popover-foreground"
                  )}
                >
                  {t("allCompanies")}
                </DropdownMenuItem>
                {companies.map((co) => (
                  <DropdownMenuItem
                    key={co}
                    onClick={() => setSelectedCompany(co)}
                    className={cn(
                      "text-sm",
                      selectedCompany === co
                        ? "text-primary"
                        : "text-popover-foreground"
                    )}
                  >
                    <span className="truncate">{co}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {hasContactFilters && (
          <div className="flex flex-wrap items-center gap-1">
            {selectedTagIds.map((id) => {
              const tag = tagsById.get(id);
              return (
                <button
                  key={id}
                  onClick={() => toggleTag(id)}
                  className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-foreground hover:bg-muted/70"
                >
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: tag?.color ?? "var(--muted-foreground)" }}
                  />
                  <span className="max-w-24 truncate">{tag?.name ?? t("tags")}</span>
                  <X className="h-3 w-3" />
                </button>
              );
            })}
            {selectedCompany && (
              <button
                onClick={() => setSelectedCompany(null)}
                className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-foreground hover:bg-muted/70"
              >
                <span className="max-w-24 truncate">{selectedCompany}</span>
                <X className="h-3 w-3" />
              </button>
            )}
            <button
              onClick={clearContactFilters}
              className="px-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              {t("clearAll")}
            </button>
          </div>
        )}
      </div>

      {/* Conversation Items.
          `min-h-0` is load-bearing: a flex child defaults to
          min-height:auto, so without it this ScrollArea grows to fit
          every conversation instead of shrinking to the remaining
          space — the list then overflows and gets clipped by the
          parent's overflow-hidden with no scrollbar (issue #229). */}
      <ScrollArea
        className="min-h-0 flex-1"
        style={
          platformFilter !== "all"
            ? { background: platformSoftBackground(platformFilter, 6, "--card") }
            : undefined
        }
      >
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-sm text-muted-foreground">{t("noConversations")}</p>
          </div>
        ) : (
          <div className="flex flex-col">
            {filtered.map((conv) => (
              <ConversationItem
                key={conv.id}
                conversation={conv}
                isActive={conv.id === activeConversationId}
                onSelect={handleSelect}
                t={t}
                showPlatformBadge={platformFilter === "all"}
                analyzing={isAnalyzing(conv, hasQualificationCriteria, now)}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

interface ConversationItemProps {
  conversation: Conversation;
  isActive: boolean;
  onSelect: (conversation: Conversation) => void;
  t: ReturnType<typeof useTranslations>;
  showPlatformBadge: boolean;
  /** True while the AI is plausibly still scoring this turn — see
   *  `isAnalyzing` above. Transient by nature, so it gets its own look
   *  rather than reusing the (settled) score badge's styling. */
  analyzing: boolean;
}

function ConversationItem({
  conversation,
  isActive,
  onSelect,
  t,
  showPlatformBadge,
  analyzing,
}: ConversationItemProps) {
  const contact = conversation.contact;
  const displayName = contact?.name || contact?.phone || t("unknown");
  const initials = displayName.charAt(0).toUpperCase();
  const platform = getConversationPlatform(conversation);

  const handleClick = useCallback(() => {
    onSelect(conversation);
  }, [onSelect, conversation]);

  const timeAgo = conversation.last_message_at
    ? formatDistanceToNow(new Date(conversation.last_message_at), {
        addSuffix: false,
      })
    : "";

  return (
    <button
      onClick={handleClick}
      className={cn(
        "flex w-full items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/50",
        isActive && "border-l-2 border-primary bg-muted/70",
        // A conversation the AI is actively working on right now is a
        // transient state, not a settled one — give it its own subtle
        // treatment so it never reads as just another scored row.
        analyzing && !isActive && "border-l-2 border-violet-500/40 bg-violet-500/[0.04]",
      )}
    >
      {/* Avatar — Instagram conversations get the gradient "story ring";
          the platform badge (only shown on the "Todas" tab) sits at the
          bottom-right corner so a mixed list stays scannable. */}
      <div className="relative shrink-0">
        <AvatarRing platform={platform} sizeClass="h-10 w-10">
          <div className="flex h-full w-full items-center justify-center rounded-full bg-muted text-sm font-medium text-foreground">
            {contact?.avatar_url ? (
              <img
                src={contact.avatar_url}
                alt={displayName}
                className="h-full w-full rounded-full object-cover"
              />
            ) : (
              initials
            )}
          </div>
        </AvatarRing>
        {showPlatformBadge && (
          <span className="absolute -bottom-0.5 -right-0.5">
            <PlatformIcon platform={platform} className="h-2.5 w-2.5" />
          </span>
        )}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-medium text-foreground">{displayName}</span>
          <span className="shrink-0 text-[10px] text-muted-foreground">{timeAgo}</span>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <p className="truncate text-xs text-muted-foreground">
            {conversation.last_message_text || t("noMessagesYet")}
          </p>
          <div className="flex shrink-0 items-center gap-1.5">
            {conversation.unread_count > 0 && (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-500 px-1 text-[10px] font-bold text-white">
                {conversation.unread_count}
              </span>
            )}
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                STATUS_COLORS[conversation.status]
              )}
              title={conversation.status}
            />
          </div>
        </div>

        {/* AI line — either the transient "analyzing" state, or the
            settled score badge + a short (word-trimmed, ~3-word) reason
            snippet, always visible rather than hover-only so it reads
            the same on a tablet as on desktop. Small and muted enough
            to stay a secondary label, not compete with the message
            preview above it. The badge itself keeps its own hover
            tooltip (full reason + staleness note) as a bonus for mouse
            users. Nothing renders when neither state applies (unscored
            contact, account without qualification criteria configured). */}
        {analyzing ? (
          <p className="mt-1 flex items-center gap-1 text-[11px] font-medium text-violet-500">
            <span className="flex gap-0.5" aria-hidden>
              <span className="h-1 w-1 animate-bounce rounded-full bg-violet-500 [animation-delay:-0.3s]" />
              <span className="h-1 w-1 animate-bounce rounded-full bg-violet-500 [animation-delay:-0.15s]" />
              <span className="h-1 w-1 animate-bounce rounded-full bg-violet-500" />
            </span>
            {t("analyzing")}
          </p>
        ) : contact?.lead_score ? (
          <div className="mt-1 flex min-w-0 items-center gap-1">
            <LeadScoreBadge
              score={contact.lead_score}
              reason={contact.lead_score_reason}
              updatedAt={contact.lead_score_updated_at}
            />
            {contact.lead_score_reason && (
              <span className="truncate text-[10px] font-medium text-muted-foreground">
                {shortenReason(contact.lead_score_reason)}
              </span>
            )}
          </div>
        ) : null}
      </div>
    </button>
  );
}
