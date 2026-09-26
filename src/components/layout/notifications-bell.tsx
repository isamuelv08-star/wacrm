"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Bell, Loader2, Trash2 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useUnreadNotifications } from "@/hooks/use-unread-notifications";
import type { Notification } from "@/types";
import { groupNotifications } from "@/lib/notifications/group-notifications";
import { NotificationRow } from "@/components/notifications/notification-row";
import { NotificationGroupRow } from "@/components/notifications/notification-group-row";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";

const DROPDOWN_LIMIT = 20;

/**
 * Header bell — the notification tray that used to live only on its
 * own /notifications page (still reachable via "Ver todas" below, and
 * still the sidebar's deep-link target for a saved bookmark, but no
 * longer in the sidebar's own nav list — see sidebar.tsx). Opening a
 * notification here marks it read AND removes it from the list (not
 * just dims it), so the tray naturally empties as it's used; "Borrar
 * todas" clears everything at once for anyone who'd rather not open
 * them one by one.
 */
export function NotificationsBell() {
  const t = useTranslations("NotificationsPage");
  const tHeader = useTranslations("Header");
  const router = useRouter();
  const { accountId, user } = useAuth();
  const userId = user?.id ?? null;
  const unreadCount = useUnreadNotifications();

  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[] | null>(null);
  const [clearing, setClearing] = useState(false);

  const load = useCallback(async () => {
    if (!accountId) return;
    const supabase = createClient();
    const { data, error } = await supabase
      .from("notifications")
      .select("*")
      .eq("account_id", accountId)
      .order("created_at", { ascending: false })
      .limit(DROPDOWN_LIMIT);
    if (!error) setNotifications((data ?? []) as Notification[]);
  }, [accountId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- lazy-load on first open
    if (open && notifications === null) void load();
  }, [open, notifications, load]);

  // Realtime — a new notification arriving while the tray is closed
  // still needs to appear the moment it's reopened.
  useEffect(() => {
    if (!userId) return;
    const supabase = createClient();
    const onChange = (payload: RealtimePostgresChangesPayload<Notification>) => {
      if (payload.eventType === "INSERT") {
        const row = payload.new as Notification;
        setNotifications((prev) => {
          if (!prev) return prev;
          if (prev.some((n) => n.id === row.id)) return prev;
          return [row, ...prev].slice(0, DROPDOWN_LIMIT);
        });
      } else if (payload.eventType === "DELETE") {
        const oldRow = payload.old as Partial<Notification>;
        setNotifications((prev) => prev?.filter((n) => n.id !== oldRow.id) ?? prev);
      }
    };
    // Only this user's rows: unfiltered, Realtime checked every
    // notification of every account against this subscriber. DELETE
    // events can't be filtered, hence the separate listener.
    const channel = supabase
      .channel(`notifications-bell:${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        onChange,
      )
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "notifications" }, onChange)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  // Opening a notification here removes it outright (delete, not just
  // mark-read) — the bell tray is meant to empty out as you read it,
  // unlike the full /notifications page which keeps read ones around.
  const handleClick = useCallback(
    async (n: Notification) => {
      setNotifications((prev) => prev?.filter((x) => x.id !== n.id) ?? prev);
      setOpen(false);
      if (n.conversation_id) {
        router.push(`/inbox?c=${n.conversation_id}`);
      }
      const supabase = createClient();
      const { error } = await supabase.from("notifications").delete().eq("id", n.id);
      if (error) load();
    },
    [router, load],
  );

  const clearAll = useCallback(async () => {
    if (!notifications || notifications.length === 0) return;
    setClearing(true);
    const ids = notifications.map((n) => n.id);
    setNotifications([]);
    const supabase = createClient();
    const { error } = await supabase.from("notifications").delete().in("id", ids);
    setClearing(false);
    if (error) {
      toast.error(t("markAllError"));
      load();
    }
  }, [notifications, load, t]);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        aria-label={tHeader("openNotifications")}
        className="relative flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none data-popup-open:bg-muted"
      >
        <Bell className="h-4.5 w-4.5" />
        {unreadCount > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-semibold text-primary-foreground">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="w-80 bg-popover p-0 text-popover-foreground ring-border"
      >
        <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
          <span className="text-sm font-semibold text-foreground">{t("title")}</span>
          {notifications && notifications.length > 0 && (
            <button
              type="button"
              onClick={clearAll}
              disabled={clearing}
              className="flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
            >
              {clearing ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Trash2 className="h-3 w-3" />
              )}
              {t("markAllRead")}
            </button>
          )}
        </div>

        <div className="max-h-96 overflow-y-auto p-2">
          {notifications === null ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center gap-1 py-8 text-center">
              <Bell className="h-5 w-5 text-muted-foreground" />
              <p className="mt-1 text-xs font-medium text-foreground">{t("emptyTitle")}</p>
            </div>
          ) : (
            <ul className="space-y-1.5">
              {groupNotifications(notifications).map((entry) =>
                entry.kind === "group" ? (
                  <li key={entry.key}>
                    <NotificationGroupRow group={entry} onClick={handleClick} />
                  </li>
                ) : (
                  <li key={entry.notification.id}>
                    <NotificationRow notification={entry.notification} onClick={handleClick} compact />
                  </li>
                ),
              )}
            </ul>
          )}
        </div>

        <button
          type="button"
          onClick={() => {
            setOpen(false);
            router.push("/notifications");
          }}
          className="block w-full border-t border-border px-3 py-2 text-center text-xs font-medium text-primary transition-colors hover:bg-muted"
        >
          {t("viewAll")}
        </button>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
