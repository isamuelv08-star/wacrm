"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useServerClock } from "@/hooks/use-server-clock";
import {
  DESKTOP_NOTIFICATIONS_STORAGE_KEY,
  isDesktopNotificationsSupported,
  showDesktopNotification,
} from "@/lib/notifications/desktop";
import { installAudioUnlock, playNotificationSound } from "@/lib/notifications/sound";
import {
  PENDING_ASSIGNMENT_LIMIT,
  PENDING_ASSIGNMENT_WINDOW_HOURS,
  isPersistentAssignment,
} from "@/lib/notifications/persistence";
import type { Notification as AppNotification } from "@/types";

const PROMPT_DISMISSED_KEY = "saleslid:desktop-notifications-prompt-dismissed";
const PROMPT_TOAST_ID = "enable-desktop-notifications";

/**
 * Headless — surfaces every notification the signed-in user receives in
 * real time while the app is open, in addition to (not instead of) the
 * Notifications bandeja, which already shows every row via
 * `/notifications` and the unread badge (`useUnreadNotifications`).
 * Same mechanism as those: a Realtime `postgres_changes` subscription
 * on `notifications`, scoped by RLS to `auth.uid() = user_id` — no
 * explicit filter needed.
 *
 * Deliberately not scoped to a specific notification `type` — HOT-lead
 * alerts are just as time-sensitive as a new assignment, so all of them
 * surface here the same way: an in-app toast, a chime (unless the user
 * turned it off — lib/notifications/sound.ts) and, when the tab isn't
 * focused, a native OS notification (when the browser permission is
 * granted — lib/notifications/desktop.ts).
 *
 * One exception: a `new_message` notification for the conversation
 * the user currently has open in the Inbox is skipped — the message
 * already appears directly in the open thread, so toasting it too
 * would just be a redundant popup for the one conversation they're
 * actively looking at. Read via `window.location` (not a routing
 * hook) since this only needs the URL at the moment the event fires,
 * not a reactive value — keeps this component free of the Suspense
 * boundary `useSearchParams` would otherwise require.
 *
 * Round-robin leads (a system assignment, in an account on the shared
 * WhatsApp number — see lib/notifications/persistence.ts) are treated
 * as urgent: a distinct chime, a toast with no auto-dismiss and no
 * close button that stays until the agent clicks "Manage", and an OS
 * notification with `requireInteraction`. Any such lead still unread
 * from the last day is re-surfaced when the app loads, so one assigned
 * while the tab was closed is waiting for the agent. Reading it from
 * anywhere else (the bandeja, another tab) dismisses the toast.
 */
export function NewNotificationToastListener() {
  const router = useRouter();
  const t = useTranslations("NotificationsToast");
  const { user, account } = useAuth();
  const userId = user?.id ?? null;
  const whatsappMode = account?.whatsapp_mode ?? null;
  const { now: serverNow } = useServerClock();

  // Audio is blocked until the first user gesture — arm the unlock once.
  useEffect(() => installAudioUnlock(), []);

  useEffect(() => {
    if (!userId) return;
    const supabase = createClient();

    const targetFor = (row: AppNotification): string | null => {
      if (row.type === "team_chat_mention") return "/team-chat";
      if (row.type === "ai_provider_error") return "/agents";
      if (row.conversation_id) return `/inbox?c=${row.conversation_id}`;
      if (row.type === "contact_note_mention") return "/contacts";
      return null;
    };

    const markRead = (id: string) =>
      supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("id", id)
        .is("read_at", null)
        .then(() => {});

    const open = (row: AppNotification) => {
      void markRead(row.id);
      const target = targetFor(row);
      if (target) router.push(target);
    };

    /** "Ana Pérez" for a lead assigned to you — falls back to a
     *  generic line when the contact can't be resolved. */
    const assignmentText = async (row: AppNotification) => {
      let name: string | null = null;
      if (row.contact_id) {
        const { data } = await supabase
          .from("contacts")
          .select("name, phone")
          .eq("id", row.contact_id)
          .maybeSingle();
        name = data?.name || data?.phone || null;
      }
      return {
        title: t("assignedTitle"),
        description: name ? t("assignedBody", { name }) : t("assignedBodyNoName"),
      };
    };

    const showPersistentAssignment = (
      row: AppNotification,
      text: { title: string; description: string },
    ) => {
      toast(text.title, {
        id: row.id,
        description: text.description,
        duration: Infinity,
        dismissible: false,
        action: { label: t("manage"), onClick: () => open(row) },
      });
    };

    /** Native OS notification — only when the tab isn't in front of the
     *  user (an in-app toast already covers that), except `new_lead`,
     *  which always pops as it did before. */
    const notifyOs = (
      row: AppNotification,
      title: string,
      body: string | undefined,
      persistent: boolean,
    ) => {
      const away = document.hidden || !document.hasFocus();
      if (!away && row.type !== "new_lead") return;
      const n = showDesktopNotification(title, {
        body,
        tag: row.id,
        requireInteraction: persistent,
      });
      if (n) {
        n.onclick = () => {
          window.focus();
          open(row);
          n.close();
        };
      }
    };

    const channel = supabase
      .channel("notifications-toast")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) => {
          const row = payload.new as AppNotification;

          if (row.type === "new_message" && row.conversation_id) {
            const onInboxWithThisConversation =
              window.location.pathname === "/inbox" &&
              new URLSearchParams(window.location.search).get("c") ===
                row.conversation_id;
            if (onInboxWithThisConversation) return;
          }

          // Already looking at the team chat itself — the mention is
          // already visible in the open thread, same skip-if-viewing
          // posture as new_message above.
          if (row.type === "team_chat_mention" && window.location.pathname === "/team-chat") {
            return;
          }

          const persistent = isPersistentAssignment(row, whatsappMode);
          playNotificationSound({ urgent: persistent });

          if (persistent) {
            void assignmentText(row).then((text) => {
              showPersistentAssignment(row, text);
              notifyOs(row, text.title, text.description, true);
            });
            return;
          }

          const target = targetFor(row);
          toast(row.title, {
            id: row.id,
            description: row.body,
            action: target
              ? {
                  label: t("manage"),
                  onClick: () => open(row),
                }
              : undefined,
          });
          notifyOs(row, row.title, row.body ?? undefined, false);
        },
      )
      // Read (or cleared) somewhere else — the bandeja, another tab —
      // so a toast that never auto-dismisses doesn't outlive the row.
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) => {
          const row = payload.new as AppNotification;
          if (row.read_at) toast.dismiss(row.id);
        },
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "notifications" },
        (payload) => {
          const old = payload.old as Partial<AppNotification>;
          if (old.id) toast.dismiss(old.id);
        },
      )
      .subscribe();

    // Leads assigned while the app was closed: still unread → still here.
    let alive = true;
    if (userId && whatsappMode === "shared") {
      // Measured against the server's clock (useServerClock), same fix
      // as the inbox's 24h session timer — a device with a wrong clock
      // used to compute a skewed cutoff here, catching up on either
      // fewer or more pending-assignment toasts than it should.
      const since = new Date(
        serverNow().getTime() - PENDING_ASSIGNMENT_WINDOW_HOURS * 3_600_000,
      ).toISOString();
      void supabase
        .from("notifications")
        .select("*")
        .eq("user_id", userId)
        .eq("type", "conversation_assigned")
        .is("actor_user_id", null)
        .is("read_at", null)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(PENDING_ASSIGNMENT_LIMIT)
        .then(async ({ data }) => {
          // Oldest first, so the newest ends up on top of the stack.
          for (const row of ((data ?? []) as AppNotification[]).reverse()) {
            if (!alive) return;
            showPersistentAssignment(row, await assignmentText(row));
          }
        });
    }

    return () => {
      alive = false;
      supabase.removeChannel(channel);
    };
    // serverNow is a stable ref-backed getter (useServerClock) — reading
    // it here isn't meant to resubscribe the realtime channel on every
    // render, the same posture message-thread.tsx's sessionInfo memo
    // already takes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, t, userId, whatsappMode]);

  // One-time invitation to turn on browser notifications. The opt-in
  // used to live only behind a button on the Notifications page, so
  // most people never enabled it and got nothing while on another tab.
  // `requestPermission` needs a user gesture, hence the action button.
  useEffect(() => {
    if (!isDesktopNotificationsSupported() || Notification.permission !== "default") return;
    try {
      if (localStorage.getItem(PROMPT_DISMISSED_KEY) === "true") return;
    } catch {
      // Storage unavailable — show the invitation; it's harmless.
    }
    const timer = setTimeout(() => {
      toast(t("enableTitle"), {
        id: PROMPT_TOAST_ID,
        description: t("enableBody"),
        duration: Infinity,
        action: {
          label: t("enableAction"),
          onClick: async () => {
            const result = await Notification.requestPermission();
            try {
              localStorage.setItem(DESKTOP_NOTIFICATIONS_STORAGE_KEY, String(result === "granted"));
            } catch {
              // Persistence is best-effort.
            }
            if (result === "granted") playNotificationSound();
          },
        },
        cancel: {
          label: t("enableDismiss"),
          onClick: () => {
            try {
              localStorage.setItem(PROMPT_DISMISSED_KEY, "true");
            } catch {
              // Persistence is best-effort.
            }
          },
        },
      });
    }, 5000);
    return () => clearTimeout(timer);
  }, [t]);

  return null;
}
