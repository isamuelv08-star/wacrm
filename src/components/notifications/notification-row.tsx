"use client";

import { useTranslations } from "next-intl";
import { formatDistanceToNow } from "date-fns";
import type { Notification } from "@/types";
import { NOTIFICATION_TYPE_ICON } from "@/lib/notifications/type-icon";
import { cn } from "@/lib/utils";

interface NotificationRowProps {
  notification: Notification;
  onClick: (notification: Notification) => void;
  /** Group rows render their children a touch more compact — no card
   *  border, since the Accordion trigger above already provides one. */
  compact?: boolean;
}

/** One notification row — the flat page's own list item, and also
 *  what a NotificationGroupRow reveals once expanded. */
export function NotificationRow({ notification, onClick, compact }: NotificationRowProps) {
  const t = useTranslations("NotificationsPage");
  const Icon = NOTIFICATION_TYPE_ICON[notification.type] ?? undefined;
  const isUnread = !notification.read_at;

  return (
    <button
      type="button"
      onClick={() => onClick(notification)}
      className={cn(
        "flex w-full items-start gap-3 rounded-xl border p-4 text-left transition-colors",
        compact && "p-3",
        isUnread
          ? "border-primary/30 bg-primary/5 hover:border-primary/50"
          : "border-border bg-card hover:border-border/70",
      )}
    >
      <div
        className={cn(
          "flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg",
          compact && "h-8 w-8",
          isUnread ? "bg-primary/15" : "bg-muted",
        )}
        aria-hidden
      >
        {Icon ? (
          <Icon
            className={cn("h-5 w-5", compact && "h-4 w-4", isUnread ? "text-primary" : "text-muted-foreground")}
          />
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "truncate text-sm font-semibold",
              isUnread ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {notification.title}
          </span>
          {isUnread && (
            <span
              aria-label={t("unreadAria")}
              className="h-2 w-2 flex-shrink-0 rounded-full bg-primary"
            />
          )}
        </div>
        {notification.body && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{notification.body}</p>
        )}
        <p className="mt-1 text-[11px] text-muted-foreground/70">
          {formatDistanceToNow(new Date(notification.created_at), { addSuffix: true })}
        </p>
      </div>
    </button>
  );
}
