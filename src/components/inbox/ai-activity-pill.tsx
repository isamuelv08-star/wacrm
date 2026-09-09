"use client";

import { Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import type { AiActivityEvent } from "@/types";

/**
 * Subtle inline marker for "what the AI just did" (migration 075) —
 * rendered in the message thread at the exact point in time it
 * happened, alongside real messages, so an admin watching a
 * conversation can see the bot qualify/advance a lead as it happens
 * instead of discovering it later on the contact record.
 *
 * Deliberately NOT a MessageBubble: no reply/react affordances, no
 * sender avatar — it's a system note about the conversation, not a
 * turn in it.
 */
export function AiActivityPill({ event }: { event: AiActivityEvent }) {
  const t = useTranslations("Inbox.aiActivity");
  const tScore = useTranslations("Leads");

  let label: string;
  switch (event.event_type) {
    case "lead_scored":
      if (!event.payload.score) return null;
      label = t("leadScored", { score: tScore(event.payload.score) });
      break;
    case "lead_qualified":
      label = t("leadQualified");
      break;
    default:
      // Unknown/future event type (older client, newer server) —
      // render nothing rather than a confusing raw value.
      return null;
  }

  return (
    <div className="flex items-center justify-center py-1">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/8 px-3 py-1 text-[11px] font-medium text-primary/80">
        <Sparkles className="h-3 w-3 shrink-0" />
        {label}
      </span>
    </div>
  );
}
