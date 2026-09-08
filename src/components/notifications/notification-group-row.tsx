"use client";

import { useTranslations } from "next-intl";
import { formatDistanceToNow } from "date-fns";
import { MessageCircle, Sparkles } from "lucide-react";
import type { Notification } from "@/types";
import type { NotificationGroupEntry } from "@/lib/notifications/group-notifications";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { cn } from "@/lib/utils";
import { NotificationRow } from "./notification-row";

const GROUP_ICON = {
  messages: MessageCircle,
  qualification: Sparkles,
} as const;

const GROUP_TITLE_KEY = {
  messages: "messagesGroupTitle",
  qualification: "qualificationGroupTitle",
} as const;

interface NotificationGroupRowProps {
  group: NotificationGroupEntry;
  onClick: (notification: Notification) => void;
}

/**
 * One collapsed "N mensajes nuevos" row standing in for a run of
 * consecutive same-kind notifications — see
 * lib/notifications/group-notifications.ts for how the run is built.
 * Mirrors pipelines/deal-group-row.tsx: its own independent Accordion
 * so expanding one group never affects any other, and the members
 * only mount once expanded.
 */
export function NotificationGroupRow({ group, onClick }: NotificationGroupRowProps) {
  const t = useTranslations("NotificationsPage");
  const Icon = GROUP_ICON[group.groupKind];
  const isUnread = group.unreadCount > 0;
  const latest = group.notifications[0];

  return (
    <Accordion>
      <AccordionItem>
        <AccordionTrigger
          className={cn(
            "rounded-xl border p-4 no-underline hover:no-underline",
            isUnread
              ? "border-primary/30 bg-primary/5 hover:border-primary/50"
              : "border-border bg-card hover:border-border/70",
          )}
        >
          <span
            className={cn(
              "flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg",
              isUnread ? "bg-primary/15" : "bg-muted",
            )}
            aria-hidden
          >
            <Icon className={cn("h-5 w-5", isUnread ? "text-primary" : "text-muted-foreground")} />
          </span>
          <span className="min-w-0 flex-1 pl-3 text-left">
            <span className="flex items-center gap-2">
              <span
                className={cn(
                  "truncate text-sm font-semibold",
                  isUnread ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {t(GROUP_TITLE_KEY[group.groupKind], { count: group.notifications.length })}
              </span>
              {isUnread && (
                <span className="flex-shrink-0 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
                  {t("groupUnread", { count: group.unreadCount })}
                </span>
              )}
            </span>
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
              {latest.body ?? latest.title}
            </span>
            <span className="mt-1 block text-[11px] text-muted-foreground/70">
              {formatDistanceToNow(new Date(latest.created_at), { addSuffix: true })}
            </span>
          </span>
        </AccordionTrigger>
        <AccordionContent className="pt-2">
          <div className="flex flex-col gap-1.5 pl-2">
            {group.notifications.map((notification) => (
              <NotificationRow
                key={notification.id}
                notification={notification}
                onClick={onClick}
                compact
              />
            ))}
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
