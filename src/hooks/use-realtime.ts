"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Message, Conversation, Contact } from "@/types";
import type { RealtimeChannel } from "@supabase/supabase-js";

interface RealtimeEvent<T> {
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new: T;
  old: Partial<T>;
}

interface UseRealtimeOptions {
  channelName: string;
  onMessageEvent?: (event: RealtimeEvent<Message>) => void;
  onConversationEvent?: (event: RealtimeEvent<Conversation>) => void;
  /** Contact row changes — currently used for live lead-score updates
   *  (Inbox's "AI is analyzing" → badge transition). `contacts` is
   *  already in the `supabase_realtime` publication (migration 059). */
  onContactEvent?: (event: RealtimeEvent<Contact>) => void;
  /** Scopes conversation/contact changes to this account. Nothing is
   *  subscribed until it's known. */
  accountId: string | null;
  /** Message changes are only needed for the open thread — the list's
   *  previews/unread badges come from the conversation UPDATE that
   *  every new message triggers. */
  activeConversationId: string | null;
  enabled?: boolean;
}

export function useRealtime({
  channelName,
  onMessageEvent,
  onConversationEvent,
  onContactEvent,
  accountId,
  activeConversationId,
  enabled = true,
}: UseRealtimeOptions) {
  const channelRef = useRef<RealtimeChannel | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  // Store latest callbacks in refs to avoid re-subscribing when the
  // parent re-renders with fresh closures. Assigned inside an effect
  // so the mutation doesn't happen during render (React 19's refs
  // rule) — subscribers only read `.current` inside async Realtime
  // callbacks, which always run after the render that updates it.
  const onMessageRef = useRef(onMessageEvent);
  const onConversationRef = useRef(onConversationEvent);
  const onContactRef = useRef(onContactEvent);
  useEffect(() => {
    onMessageRef.current = onMessageEvent;
    onConversationRef.current = onConversationEvent;
    onContactRef.current = onContactEvent;
  });

  // Scale: unfiltered subscriptions made Supabase Realtime check EVERY
  // message / conversation / contact change of EVERY account against
  // every connected agent's permissions. Filtered, each agent only
  // receives their own account's rows and their open thread's messages.
  useEffect(() => {
    if (!enabled || !activeConversationId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`${channelName}:messages:${activeConversationId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${activeConversationId}`,
        },
        (payload) => {
          onMessageRef.current?.({
            eventType: payload.eventType as RealtimeEvent<Message>["eventType"],
            new: payload.new as Message,
            old: payload.old as Partial<Message>,
          });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [channelName, enabled, activeConversationId]);

  useEffect(() => {
    if (!enabled || !accountId) return;

    const supabase = createClient();

    const channel = supabase
      .channel(`${channelName}:${accountId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversations", filter: `account_id=eq.${accountId}` },
        (payload) => {
          onConversationRef.current?.({
            eventType: payload.eventType as RealtimeEvent<Conversation>["eventType"],
            new: payload.new as Conversation,
            old: payload.old as Partial<Conversation>,
          });
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "contacts", filter: `account_id=eq.${accountId}` },
        (payload) => {
          onContactRef.current?.({
            eventType: payload.eventType as RealtimeEvent<Contact>["eventType"],
            new: payload.new as Contact,
            old: payload.old as Partial<Contact>,
          });
        }
      )
      .subscribe((status) => {
        setIsConnected(status === "SUBSCRIBED");
      });

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
      setIsConnected(false);
    };
  }, [channelName, enabled, accountId]);

  const unsubscribe = useCallback(() => {
    if (channelRef.current) {
      const supabase = createClient();
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
      setIsConnected(false);
    }
  }, []);

  return { isConnected, unsubscribe };
}
