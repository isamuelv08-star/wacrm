"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import type { Notification } from "@/types";

/**
 * Headless — pops a toast for every notification the signed-in user
 * receives in real time while the app is open, in addition to (not
 * instead of) the Notifications bandeja, which already shows every
 * row via `/notifications` and the unread badge
 * (`useUnreadNotifications`). Same mechanism as those: a Realtime
 * `postgres_changes` subscription on `notifications`, scoped by RLS to
 * `auth.uid() = user_id` — no explicit filter needed.
 *
 * Deliberately not scoped to a specific notification `type` — HOT-lead
 * alerts (Fase 2) are just as time-sensitive as a new assignment, so
 * both surface here the same way.
 *
 * One exception: a `new_message` notification for the conversation
 * the user currently has open in the Inbox is skipped — the message
 * already appears directly in the open thread, so toasting it too
 * would just be a redundant popup for the one conversation they're
 * actively looking at. Read via `window.location` (not a routing
 * hook) since this only needs the URL at the moment the event fires,
 * not a reactive value — keeps this component free of the Suspense
 * boundary `useSearchParams` would otherwise require.
 */
export function NewNotificationToastListener() {
  const router = useRouter();
  const t = useTranslations("NotificationsToast");

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("notifications-toast")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications" },
        (payload) => {
          const row = payload.new as Notification;

          if (row.type === "new_message" && row.conversation_id) {
            const onInboxWithThisConversation =
              window.location.pathname === "/inbox" &&
              new URLSearchParams(window.location.search).get("c") ===
                row.conversation_id;
            if (onInboxWithThisConversation) return;
          }

          toast(row.title, {
            description: row.body,
            action: row.conversation_id
              ? {
                  label: t("manage"),
                  onClick: () => router.push(`/inbox?c=${row.conversation_id}`),
                }
              : undefined,
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [router, t]);

  return null;
}
