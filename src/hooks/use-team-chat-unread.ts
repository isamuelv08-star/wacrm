"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { loadTeamChatUnreadCount, TEAM_CHAT_READ_EVENT } from "@/lib/team-chat/queries";

/**
 * Unread team-chat message count for the sidebar nav dot — same job
 * as useTotalUnread does for the Inbox entry, on its own realtime
 * channel so the two coexist independently. Re-derives on every new
 * message rather than keeping an incremental local counter (unlike
 * useTotalUnread's per-conversation map) — team chat volume is low
 * (an internal tool, not customer traffic), so a fresh count per
 * event is cheap and avoids drifting out of sync with
 * `team_chat_last_read_at` changes made from another tab.
 */
export function useTeamChatUnread(): number {
  const { accountId, user } = useAuth();
  const [count, setCount] = useState(0);
  const pathname = usePathname();

  useEffect(() => {
    if (!accountId || !user?.id) return;
    const supabase = createClient();
    const userId = user.id;
    let cancelled = false;

    async function refresh() {
      const { data: profileRow } = await supabase
        .from("profiles")
        .select("team_chat_last_read_at")
        .eq("user_id", userId)
        .maybeSingle();
      if (cancelled) return;
      const n = await loadTeamChatUnreadCount(
        supabase,
        accountId as string,
        userId,
        (profileRow?.team_chat_last_read_at as string | null) ?? null,
      );
      if (!cancelled) setCount(n);
    }
    void refresh();

    const channel = supabase
      .channel("team-chat-unread")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "team_chat_messages",
          filter: `account_id=eq.${accountId}`,
        },
        () => void refresh(),
      )
      .subscribe();

    // The page marks read → refresh now instead of waiting for the next
    // message (the dot used to stay lit after reading).
    const onRead = () => void refresh();
    window.addEventListener(TEAM_CHAT_READ_EVENT, onRead);

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
      window.removeEventListener(TEAM_CHAT_READ_EVENT, onRead);
    };
  }, [accountId, user?.id]);

  // Nothing is "unread" while you're looking at it.
  return pathname?.startsWith("/team-chat") ? 0 : count;
}
