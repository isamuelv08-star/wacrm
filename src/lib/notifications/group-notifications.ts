import type { Notification, NotificationType } from "@/types";

// ============================================================
// Collapses consecutive runs of the "chatty" notification types —
// new messages and lead-qualification updates — into a single group
// row, the same idea as pipelines/deal-groups.ts bundling a stage
// column's older leads: a run of same-kind notifications shouldn't
// render as N full-height rows when one collapsed summary says the
// same thing and takes a fraction of the space. `notifications` is
// assumed already sorted newest-first (as the Notifications page
// fetches it) — runs are consecutive in that order, so a message
// notification sandwiched between two assignment alerts still stands
// on its own instead of merging with a message from an hour earlier.
// ============================================================

export type NotificationGroupKind = "messages" | "qualification";

/** Notification types that fold into a group once 2+ appear back to
 *  back. Everything else (new leads, assignments, hot/stale alerts)
 *  is a one-off, time-sensitive alert that always stays its own row. */
const GROUP_KIND_BY_TYPE: Partial<Record<NotificationType, NotificationGroupKind>> = {
  new_message: "messages",
  lead_qualified: "qualification",
  lead_scored: "qualification",
};

/** Below this many, a run renders as individual rows instead of a
 *  group of one — same rationale as pipelines' MIN_GROUP_SIZE. */
export const MIN_NOTIFICATION_GROUP_SIZE = 2;

export interface IndividualNotificationEntry {
  kind: "individual";
  notification: Notification;
}

export interface NotificationGroupEntry {
  kind: "group";
  groupKind: NotificationGroupKind;
  key: string;
  /** Newest first, mirroring the input order. */
  notifications: Notification[];
  unreadCount: number;
}

export type NotificationEntry = IndividualNotificationEntry | NotificationGroupEntry;

export function groupNotifications(notifications: Notification[]): NotificationEntry[] {
  const entries: NotificationEntry[] = [];
  let i = 0;

  while (i < notifications.length) {
    const groupKind = GROUP_KIND_BY_TYPE[notifications[i].type];

    if (!groupKind) {
      entries.push({ kind: "individual", notification: notifications[i] });
      i++;
      continue;
    }

    let j = i + 1;
    while (j < notifications.length && GROUP_KIND_BY_TYPE[notifications[j].type] === groupKind) {
      j++;
    }

    const run = notifications.slice(i, j);
    if (run.length < MIN_NOTIFICATION_GROUP_SIZE) {
      for (const item of run) entries.push({ kind: "individual", notification: item });
    } else {
      entries.push({
        kind: "group",
        groupKind,
        key: `${groupKind}-${run[0].id}`,
        notifications: run,
        unreadCount: run.filter((n) => !n.read_at).length,
      });
    }
    i = j;
  }

  return entries;
}
