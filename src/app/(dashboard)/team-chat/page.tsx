'use client';

// ============================================================
// /team-chat — one shared room per account where the owner and every
// invited member (any role) can comment, @-mention a teammate, and
// optionally attach a link to a customer conversation. Entirely
// internal — never touches WhatsApp/customer data beyond an optional
// read-only link into the inbox.
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, MessagesSquare } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { loadTeamRoster, type TeamMember } from '@/lib/dashboard/member-detail';
import {
  deleteTeamChatMessage,
  loadTeamChatMessages,
  markTeamChatRead,
  type TeamChatMessage as TeamChatMessageData,
} from '@/lib/team-chat/queries';
import { TeamChatComposer } from '@/components/team-chat/team-chat-composer';
import { TeamChatMessage } from '@/components/team-chat/team-chat-message';

export default function TeamChatPage() {
  const t = useTranslations('TeamChat.page');
  const { user, accountId, accountRole } = useAuth();
  const isAdmin = accountRole === 'owner' || accountRole === 'admin';

  const [roster, setRoster] = useState<TeamMember[]>([]);
  const [messages, setMessages] = useState<TeamChatMessageData[] | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [contactNameByConversation, setContactNameByConversation] = useState<
    Map<string, string>
  >(new Map());

  const listRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);

  // Roster once — also used for @-mention autocomplete and sender
  // name/avatar lookup in the message list.
  useEffect(() => {
    if (!accountId) return;
    void loadTeamRoster(createClient()).then(setRoster);
  }, [accountId]);

  // Initial page of messages + mark-as-read (clears the sidebar dot).
  useEffect(() => {
    if (!accountId || !user?.id) return;
    let cancelled = false;
    const db = createClient();
    void loadTeamChatMessages(db, accountId).then((rows) => {
      if (cancelled) return;
      setMessages(rows);
      setHasMore(rows.length >= 50);
      requestAnimationFrame(() => {
        listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
      });
    });
    void markTeamChatRead(db, user.id);
    return () => {
      cancelled = true;
    };
  }, [accountId, user?.id]);

  // Resolve contact names for any referenced conversations in the
  // currently-loaded page, batched into one query rather than one per
  // message with an attachment.
  useEffect(() => {
    const ids = [...new Set((messages ?? []).map((m) => m.referencedConversationId).filter((id): id is string => !!id))];
    const missing = ids.filter((id) => !contactNameByConversation.has(id));
    if (missing.length === 0) return;
    void createClient()
      .from('conversations')
      .select('id, contacts(name, phone)')
      .in('id', missing)
      .then(({ data }) => {
        if (!data) return;
        setContactNameByConversation((prev) => {
          const next = new Map(prev);
          for (const row of data as { id: string; contacts: { name: string | null; phone: string } | { name: string | null; phone: string }[] | null }[]) {
            const contact = Array.isArray(row.contacts) ? row.contacts[0] : row.contacts;
            if (contact) next.set(row.id, contact.name || contact.phone);
          }
          return next;
        });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- contactNameByConversation intentionally excluded: including it would refire this on every resolved batch
  }, [messages]);

  // Realtime: append new messages, drop soft-deleted ones. Filtered by
  // account_id, same scoping style as presence:${accountId}.
  useEffect(() => {
    if (!accountId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`team-chat:${accountId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'team_chat_messages', filter: `account_id=eq.${accountId}` },
        (payload) => {
          const row = payload.new as {
            id: string;
            account_id: string;
            sender_user_id: string;
            body: string;
            mentioned_user_ids: string[] | null;
            referenced_conversation_id: string | null;
            created_at: string;
          };
          const wasNearBottom = nearBottomRef.current;
          setMessages((prev) => [
            ...(prev ?? []),
            {
              id: row.id,
              accountId: row.account_id,
              senderUserId: row.sender_user_id,
              body: row.body,
              mentionedUserIds: row.mentioned_user_ids ?? [],
              referencedConversationId: row.referenced_conversation_id,
              createdAt: row.created_at,
            },
          ]);
          if (wasNearBottom) {
            requestAnimationFrame(() => {
              listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
            });
          }
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'team_chat_messages', filter: `account_id=eq.${accountId}` },
        (payload) => {
          const row = payload.new as { id: string; deleted_at: string | null };
          if (!row.deleted_at) return;
          setMessages((prev) => (prev ?? []).filter((m) => m.id !== row.id));
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [accountId]);

  function handleScroll() {
    const el = listRef.current;
    if (!el) return;
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  const handleLoadOlder = useCallback(async () => {
    if (!accountId || !messages || messages.length === 0) return;
    setLoadingOlder(true);
    try {
      const older = await loadTeamChatMessages(createClient(), accountId, messages[0].createdAt);
      setHasMore(older.length >= 50);
      if (older.length > 0) {
        const el = listRef.current;
        const prevHeight = el?.scrollHeight ?? 0;
        setMessages((prev) => [...older, ...(prev ?? [])]);
        requestAnimationFrame(() => {
          if (el) el.scrollTop = el.scrollHeight - prevHeight;
        });
      }
    } finally {
      setLoadingOlder(false);
    }
  }, [accountId, messages]);

  async function handleDelete(messageId: string) {
    try {
      await deleteTeamChatMessage(createClient(), messageId);
      setMessages((prev) => (prev ?? []).filter((m) => m.id !== messageId));
    } catch (err) {
      console.error('[team-chat] delete failed:', err);
    }
  }

  const rosterByUserId = new Map(roster.map((m) => [m.userId, m]));

  return (
    <div className="-m-4 flex h-[calc(100vh-3.5rem)] flex-col overflow-hidden sm:-m-6 lg:-m-3 lg:h-[calc(100vh-3.5rem-1.5rem)] lg:rounded-2xl lg:border lg:border-border lg:shadow-lg lg:shadow-black/5">
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-card px-4 py-3">
        <MessagesSquare className="size-4 text-primary" />
        <div className="min-w-0">
          <h1 className="text-sm font-semibold text-foreground">{t('title')}</h1>
          <p className="text-xs text-muted-foreground">{t('subtitle')}</p>
        </div>
      </div>

      <div ref={listRef} onScroll={handleScroll} className="themed-scrollbar flex-1 overflow-y-auto px-2 py-3">
        {messages === null ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
            <MessagesSquare className="size-8 opacity-40" />
            <p className="text-sm">{t('empty')}</p>
          </div>
        ) : (
          <>
            {hasMore && (
              <div className="flex justify-center pb-2">
                <button
                  type="button"
                  onClick={() => void handleLoadOlder()}
                  disabled={loadingOlder}
                  className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"
                >
                  {loadingOlder ? <Loader2 className="size-3.5 animate-spin" /> : t('loadOlder')}
                </button>
              </div>
            )}
            {messages.map((m) => (
              <TeamChatMessage
                key={m.id}
                message={m}
                sender={rosterByUserId.get(m.senderUserId)}
                roster={roster}
                canDelete={isAdmin || m.senderUserId === user?.id}
                onDelete={handleDelete}
                referencedContactName={
                  m.referencedConversationId
                    ? (contactNameByConversation.get(m.referencedConversationId) ?? null)
                    : null
                }
              />
            ))}
          </>
        )}
      </div>

      {accountId && user?.id && (
        <TeamChatComposer accountId={accountId} senderUserId={user.id} roster={roster} />
      )}
    </div>
  );
}
