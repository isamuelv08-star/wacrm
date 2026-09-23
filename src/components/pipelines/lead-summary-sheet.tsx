"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { MessageSquare, SquarePen } from "lucide-react";
import { useTranslations } from "next-intl";
import { LeadSummaryTab } from "@/components/contacts/lead-summary-tab";
import type { Deal } from "@/types";

interface LeadSummarySheetProps {
  deal: Deal | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Opens DealForm for this deal — the sheet closes itself first so
   *  the two never stack. Editing (title/value/stage/notes) still
   *  needs its own dedicated form; this sheet is read-first. */
  onEdit: (deal: Deal) => void;
}

/**
 * What clicking a lead's card in the pipeline board opens: the exact
 * same read-first briefing the Inbox's contact sidebar and the Contacts
 * page's "Summary" tab already show (LeadSummaryTab — score + trend,
 * need/budget/objection/product, deals, commitments, activity, AI
 * executive summary), plus a jump straight into the conversation. Before
 * this, a card click only opened the deal-edit form — useful for
 * changing the title/value/stage, but told a seller nothing about how
 * the lead is actually doing without leaving the pipeline for Contacts
 * or the Inbox.
 */
export function LeadSummarySheet({
  deal,
  open,
  onOpenChange,
  onEdit,
}: LeadSummarySheetProps) {
  const t = useTranslations("Pipelines.leadSummarySheet");
  const router = useRouter();

  // Resolved live by contact_id (newest conversation), same lookup
  // DealForm already does for its own "go to conversation" link —
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

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="bg-popover border-border text-popover-foreground sm:max-w-lg w-full p-0"
      >
        <div className="flex h-full flex-col">
          <SheetHeader className="border-b border-border/50 p-4">
            <SheetTitle className="text-popover-foreground">
              {deal.contact?.name || deal.contact?.phone || deal.title}
            </SheetTitle>
          </SheetHeader>

          <div className="flex flex-wrap gap-2 border-b border-border/50 p-4">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!conversationId}
              onClick={() => {
                if (!conversationId) return;
                onOpenChange(false);
                router.push(`/inbox?c=${conversationId}`);
              }}
            >
              <MessageSquare />
              {t("goToConversation")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                onOpenChange(false);
                onEdit(deal);
              }}
            >
              <SquarePen />
              {t("editDeal")}
            </Button>
          </div>

          <div className="themed-scrollbar flex-1 overflow-y-auto p-4">
            {deal.contact ? (
              <LeadSummaryTab contact={deal.contact} />
            ) : (
              <p className="text-sm text-muted-foreground">{t("noContact")}</p>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
