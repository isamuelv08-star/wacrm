'use client';

// ============================================================
// TeamChatComposer — textarea + Enter-to-send (the same core
// auto-grow/keydown shape as the inbox's message-composer.tsx, none
// of its WhatsApp-specific plumbing: no media, templates, 24h session
// window, or interactive builder — those don't apply to an internal,
// non-customer-facing chat), plus:
//   - "@" mention autocomplete against the account roster.
//   - An "attach a conversation" picker (same contacts+conversations
//     search shape as the header's smart-search.tsx) so a message can
//     link to a specific customer chat.
// No optimistic local append on send — the realtime subscription
// (team-chat/page.tsx) echoes the sender's own insert straight back,
// same as every other realtime list in this app.
// ============================================================

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Link2, Loader2, Send, X } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { sanitizeOrSearchTerm } from '@/lib/search';
import type { TeamMember } from '@/lib/dashboard/member-detail';
import { extractMentionedUserIds } from '@/lib/team-chat/mentions';
import { sendTeamChatMessage } from '@/lib/team-chat/queries';

interface ConversationOption {
  conversationId: string;
  contactName: string;
}

export function TeamChatComposer({
  accountId,
  senderUserId,
  roster,
}: {
  accountId: string;
  senderUserId: string;
  roster: TeamMember[];
}) {
  const t = useTranslations('TeamChat.composer');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // "@" mention autocomplete
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const mentionMatches =
    mentionQuery === null
      ? []
      : roster
          .filter((m) => m.name.toLowerCase().startsWith(mentionQuery.toLowerCase()) && m.name.trim())
          .slice(0, 6);

  // Attach-a-conversation picker
  const [attachOpen, setAttachOpen] = useState(false);
  const [attachQuery, setAttachQuery] = useState('');
  const [attachResults, setAttachResults] = useState<ConversationOption[] | null>(null);
  const [attachLoading, setAttachLoading] = useState(false);
  const [attached, setAttached] = useState<ConversationOption | null>(null);

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 96)}px`;
  }, []);

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value;
    setText(value);
    adjustHeight();

    const upToCursor = value.slice(0, e.target.selectionStart ?? value.length);
    const match = /@(\S*)$/.exec(upToCursor);
    setMentionQuery(match ? match[1] : null);
  }

  function insertMention(member: TeamMember) {
    const el = textareaRef.current;
    if (!el) return;
    const cursor = el.selectionStart ?? text.length;
    const upToCursor = text.slice(0, cursor);
    const match = /@(\S*)$/.exec(upToCursor);
    if (!match) return;
    const start = match.index;
    const before = text.slice(0, start);
    const after = text.slice(cursor);
    const next = `${before}@${member.name} ${after}`;
    setText(next);
    setMentionQuery(null);
    requestAnimationFrame(() => {
      el.focus();
      const pos = before.length + member.name.length + 2;
      el.setSelectionRange(pos, pos);
    });
  }

  async function handleSend() {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    setSending(true);
    try {
      await sendTeamChatMessage(createClient(), {
        accountId,
        senderUserId,
        body: trimmed,
        mentionedUserIds: extractMentionedUserIds(trimmed, roster),
        referencedConversationId: attached?.conversationId ?? null,
      });
      setText('');
      setAttached(null);
      setMentionQuery(null);
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
    } catch (err) {
      console.error('[team-chat] send failed:', err);
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (mentionQuery !== null && mentionMatches.length > 0 && e.key === 'Enter') {
      e.preventDefault();
      insertMention(mentionMatches[0]);
      return;
    }
    if (e.key === 'Escape' && mentionQuery !== null) {
      setMentionQuery(null);
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  // Debounced contact/conversation search for the attach picker — same
  // shape as smart-search.tsx: search contacts by name/phone, resolve
  // each to its most recently updated conversation.
  useEffect(() => {
    const trimmed = attachQuery.trim();
    if (!attachOpen || trimmed.length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing stale results when the query closes or drops below the minimum length, same as smart-search.tsx
      setAttachResults(null);
      return;
    }
    setAttachLoading(true);
    const timer = setTimeout(async () => {
      const supabase = createClient();
      const escaped = sanitizeOrSearchTerm(trimmed).replace(/[%_]/g, (c) => `\\${c}`);
      const { data, error } = await supabase
        .from('contacts')
        .select('id, name, phone, conversations(id, updated_at)')
        .eq('account_id', accountId)
        .or(`name.ilike.%${escaped}%,phone.ilike.%${escaped}%`)
        .limit(6);
      if (!error && data) {
        setAttachResults(
          (data as { id: string; name: string | null; phone: string; conversations: { id: string; updated_at: string }[] | null }[])
            .map((row) => {
              const convs = row.conversations ?? [];
              const latest = [...convs].sort(
                (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
              )[0];
              return latest
                ? { conversationId: latest.id, contactName: row.name || row.phone }
                : null;
            })
            .filter((r): r is ConversationOption => r !== null),
        );
      }
      setAttachLoading(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [attachQuery, attachOpen, accountId]);

  return (
    <div className="relative border-t border-border bg-card p-3">
      {mentionQuery !== null && mentionMatches.length > 0 && (
        <div className="absolute bottom-full left-3 z-20 mb-1.5 w-56 overflow-hidden rounded-xl border border-border bg-popover shadow-lg ring-1 ring-foreground/5">
          {mentionMatches.map((m) => (
            <button
              key={m.userId}
              type="button"
              onClick={() => insertMention(m)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground hover:bg-muted"
            >
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-soft text-[11px] font-semibold text-primary">
                {m.name.charAt(0).toUpperCase()}
              </span>
              <span className="truncate">{m.name}</span>
            </button>
          ))}
        </div>
      )}

      {attached && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-2.5 py-1.5 text-xs text-foreground">
          <Link2 className="size-3.5 shrink-0 text-primary" />
          <span className="min-w-0 flex-1 truncate">{attached.contactName}</span>
          <button
            type="button"
            onClick={() => setAttached(null)}
            className="shrink-0 text-muted-foreground hover:text-foreground"
            aria-label={t('removeAttachment')}
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {attachOpen && (
        <div className="mb-2 rounded-xl border border-border bg-popover p-2 shadow-sm">
          <input
            autoFocus
            type="text"
            value={attachQuery}
            onChange={(e) => setAttachQuery(e.target.value)}
            placeholder={t('attachSearchPlaceholder')}
            className="w-full rounded-lg border border-border bg-muted/50 px-2.5 py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/50"
          />
          <div className="mt-1.5 max-h-40 overflow-y-auto">
            {attachLoading && (
              <div className="flex items-center justify-center py-3">
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              </div>
            )}
            {!attachLoading && attachResults?.length === 0 && (
              <p className="px-2 py-2 text-xs text-muted-foreground">{t('attachNoResults')}</p>
            )}
            {!attachLoading &&
              attachResults?.map((r) => (
                <button
                  key={r.conversationId}
                  type="button"
                  onClick={() => {
                    setAttached(r);
                    setAttachOpen(false);
                    setAttachQuery('');
                    setAttachResults(null);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-foreground hover:bg-muted"
                >
                  <Link2 className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{r.contactName}</span>
                </button>
              ))}
          </div>
        </div>
      )}

      <div className="flex items-end gap-2">
        <button
          type="button"
          onClick={() => setAttachOpen((v) => !v)}
          title={t('attachConversation')}
          aria-label={t('attachConversation')}
          className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Link2 className="size-4" />
        </button>

        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          rows={1}
          placeholder={t('placeholder')}
          className="max-h-24 flex-1 resize-none rounded-2xl border border-border bg-muted/50 px-3.5 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/50"
        />

        <button
          type="button"
          onClick={() => void handleSend()}
          disabled={!text.trim() || sending}
          title={t('send')}
          aria-label={t('send')}
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
        >
          {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
        </button>
      </div>
    </div>
  );
}
