"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
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
 */
export function NewNotificationToastListener() {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("notifications-toast")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications" },
        (payload) => {
          const row = payload.new as Notification;
          toast(row.title, {
            description: row.body,
            action: row.conversation_id
              ? {
                  label: "Gestionar",
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
  }, [router]);

  return null;
}
