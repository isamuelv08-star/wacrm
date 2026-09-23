"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { MessageSquare, Phone, Mail, Building2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { LeadSummaryTab } from "@/components/contacts/lead-summary-tab";
import { LeadScoreBadge } from "@/components/leads/lead-score-badge";
import { DealFormFields } from "./deal-form-fields";
import type { Contact, Deal, PipelineStage } from "@/types";

interface LeadSummarySheetProps {
  deal: Deal | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pipelineId: string;
  stages: PipelineStage[];
  onSaved: () => void;
}

function getInitials(name?: string | null): string {
  if (!name) return "?";
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

/**
 * What clicking a lead's card in the pipeline board opens — modeled
 * directly on the Contacts page's own detail sheet (ContactDetailView):
 * an avatar/name/score header, a FIXED "Go to conversation" action that
 * stays visible no matter which tab is open, and tabs below it for
 * "Summary" (LeadSummaryTab — the exact same briefing the Inbox contact
 * sidebar and Contacts' own Summary tab show: score + trend,
 * need/budget/objection/product, deals, commitments, activity, AI
 * executive summary) and "Edit" (DealFormFields, embedded — no second
 * Sheet stacking on top of this one).
 *
 * Before this, a card click only opened the deal-edit form directly,
 * telling a seller nothing about how the lead is actually doing without
 * leaving the pipeline. "Go to conversation" used to sit paired with an
 * "Edit" button inside that same view; it's deliberately pulled out into
 * the header here — it's the action you reach for constantly, editing
 * title/value/stage is occasional.
 */
export function LeadSummarySheet({
  deal,
  open,
  onOpenChange,
  pipelineId,
  stages,
  onSaved,
}: LeadSummarySheetProps) {
  const t = useTranslations("Pipelines.leadSummarySheet");
  const router = useRouter();

  // Local mirror of the contact so LeadScoreBadge's inline override
  // (editable score) can update it without a full deal refetch — same
  // pattern ContactDetailView uses for its own header badge.
  const [contact, setContact] = useState<Contact | null>(deal?.contact ?? null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting the local mirror whenever a different deal is opened, before LeadScoreBadge's own override (if any) touches it
    setContact(deal?.contact ?? null);
  }, [deal]);

  // Resolved live by contact_id (newest conversation), same lookup
  // DealFormFields already does for its own "linked conversation" hint —
  // deal.conversation_id is only ever stamped once at deal creation and
  // can lag behind which conversation is actually current.
  const [conversationId, setConversationId] = useState<string | null>(null);
  const contactId = deal?.contact_id ?? null;

  useEffect(() => {
    if (!open || !contactId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting when the sheet closes / the deal changes, before the fetch below repopulates it
      setConversationId(null);
      return;
    }
    let cancelled = false;
    createClient()
      .from("conversations")
      .select("id")
      .eq("contact_id", contactId)
      .order("last_message_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setConversationId((data as { id: string } | null)?.id ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [open, contactId]);

  if (!deal) return null;

  const displayName = contact?.name || contact?.phone || deal.title;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="bg-popover border-border text-popover-foreground sm:max-w-lg w-full p-0"
      >
        <div className="flex h-full flex-col">
          {/* Header — mirrors ContactDetailView's header exactly. */}
          <SheetHeader className="p-4 border-b border-border/50">
            <div className="flex items-center gap-3">
              <Avatar className="size-12 bg-muted border border-border">
                <AvatarFallback className="bg-primary/10 text-primary text-sm font-medium">
                  {getInitials(displayName)}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <SheetTitle className="text-popover-foreground truncate">
                    {displayName}
                  </SheetTitle>
                  {contact && (
                    <LeadScoreBadge
                      score={contact.lead_score}
                      reason={contact.lead_score_reason}
                      updatedAt={contact.lead_score_updated_at}
                      editable
                      contactId={contact.id}
                      onScoreChange={({ score, reason }) =>
                        setContact((prev) =>
                          prev ? { ...prev, lead_score: score, lead_score_reason: reason } : prev,
                        )
                      }
                    />
                  )}
                </div>
                <SheetDescription className="text-muted-foreground text-xs mt-0.5">
                  {deal.title}
                </SheetDescription>
                {contact && (
                  <div className="flex flex-wrap items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                    {contact.phone && (
                      <span className="flex items-center gap-1">
                        <Phone className="size-3" />
                        {contact.phone}
                      </span>
                    )}
                    {contact.email && (
                      <span className="flex items-center gap-1">
                        <Mail className="size-3" />
                        {contact.email}
                      </span>
                    )}
                    {contact.company && (
                      <span className="flex items-center gap-1">
                        <Building2 className="size-3" />
                        {contact.company}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Fixed action — stays visible across both tabs, unlike the
                old "go to conversation" + "edit" pair that lived inside
                the summary body and vanished once you scrolled or
                switched away. Editing moved into its own tab below. */}
            <div className="mt-3">
              <Button
                type="button"
                size="sm"
                disabled={!conversationId}
                onClick={() => {
                  if (!conversationId) return;
                  onOpenChange(false);
                  router.push(`/inbox?c=${conversationId}`);
                }}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                <MessageSquare className="size-4" />
                {t("goToConversation")}
              </Button>
            </div>
          </SheetHeader>

          {/* Tabs — same "summary" / "edit" split ContactDetailView uses
              for its own Summary/Details tabs. */}
          <Tabs defaultValue="summary" className="flex-1 flex flex-col min-h-0">
            <TabsList className="bg-muted/50 border-b border-border mx-4 mt-3">
              <TabsTrigger
                value="summary"
                className="data-active:bg-muted data-active:text-primary text-muted-foreground"
              >
                {t("tabSummary")}
              </TabsTrigger>
              <TabsTrigger
                value="edit"
                className="data-active:bg-muted data-active:text-primary text-muted-foreground"
              >
                {t("tabEdit")}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="summary" className="themed-scrollbar flex-1 overflow-y-auto px-4 py-3">
              {contact ? (
                <LeadSummaryTab contact={contact} />
              ) : (
                <p className="text-sm text-muted-foreground">{t("noContact")}</p>
              )}
            </TabsContent>

            <TabsContent value="edit" className="flex-1 overflow-hidden">
              <DealFormFields
                open={open}
                deal={deal}
                pipelineId={pipelineId}
                stages={stages}
                defaultStageId={deal.stage_id}
                onSaved={onSaved}
                onClose={() => onOpenChange(false)}
              />
            </TabsContent>
          </Tabs>
        </div>
      </SheetContent>
    </Sheet>
  );
}
