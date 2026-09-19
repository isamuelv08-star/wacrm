'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { loadTeamRoster, type TeamMember } from '@/lib/dashboard/member-detail';
import { extractMentionedUserIds, splitBodyByMentions } from '@/lib/team-chat/mentions';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ContactNote } from '@/types';
import { MentionTextarea } from './mention-textarea';

/**
 * Internal notes on a contact, with @-mentions. Shared by the Inbox
 * sidebar (right panel of a chat) and the Contacts detail sheet so both
 * read and write the same `contact_notes` rows — the note a seller
 * writes from a chat is the one their teammate sees on the contact.
 *
 * Notes are internal-only: they live in `contact_notes`, a table no
 * customer-facing path (WhatsApp/Messenger send, AI context, public
 * API) ever reads. A mention notifies the teammate through the
 * `notify_contact_note_mentions` trigger (migration 099).
 */
export function ContactNotesPanel({
  contactId,
  conversationId = null,
  compact = false,
}: {
  contactId: string;
  /** The chat the note is written from, so the mention notification can
   *  open it. Omit when writing from the Contacts sheet. */
  conversationId?: string | null;
  /** Denser type scale for the narrow Inbox sidebar. */
  compact?: boolean;
}) {
  const t = useTranslations('ContactNotes');
  const locale = useLocale();
  const { user, accountId, canSendMessages } = useAuth();

  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [roster, setRoster] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    const supabase = createClient();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting the list when the contact changes, before the fetch below repopulates it
    setLoading(true);
    setNotes([]);
    Promise.all([
      supabase
        .from('contact_notes')
        .select('*')
        .eq('contact_id', contactId)
        .order('created_at', { ascending: false }),
      loadTeamRoster(supabase).catch(() => [] as TeamMember[]),
    ]).then(([notesRes, members]) => {
      if (!alive) return;
      if (notesRes.error) toast.error(t('loadFailed'));
      setNotes((notesRes.data as ContactNote[] | null) ?? []);
      setRoster(members);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [contactId, t]);

  const submit = useCallback(async () => {
    const body = text.trim();
    if (!body || saving) return;
    if (!user || !accountId) {
      toast.error(t('notAuthenticated'));
      return;
    }
    setSaving(true);
    const mentioned = extractMentionedUserIds(body, roster).filter((id) => id !== user.id);
    const { data, error } = await createClient()
      .from('contact_notes')
      .insert({
        contact_id: contactId,
        account_id: accountId,
        user_id: user.id,
        note_text: body,
        mentioned_user_ids: mentioned,
        conversation_id: conversationId,
      })
      .select()
      .single();
    setSaving(false);

    if (error || !data) {
      console.error('[contact-notes] insert failed:', error);
      toast.error(t('addFailed'));
      return;
    }
    setNotes((prev) => [data as ContactNote, ...prev]);
    setText('');
    toast.success(
      mentioned.length > 0 ? t('savedNotified', { count: mentioned.length }) : t('saved'),
    );
  }, [text, saving, user, accountId, roster, contactId, conversationId, t]);

  const remove = useCallback(
    async (noteId: string) => {
      const { error } = await createClient().from('contact_notes').delete().eq('id', noteId);
      if (error) {
        toast.error(t('deleteFailed'));
        return;
      }
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
    },
    [t],
  );

  const authorOf = (userId: string) => roster.find((m) => m.userId === userId)?.name ?? t('teammate');
  const bodyText = compact ? 'text-xs' : 'text-sm';

  return (
    <div className="space-y-3">
      {canSendMessages ? (
        <div className="space-y-1.5">
          <MentionTextarea
            value={text}
            onChange={setText}
            roster={roster}
            placeholder={t('placeholder')}
            rows={compact ? 2 : 3}
            disabled={saving}
            onSubmit={submit}
            className={bodyText}
          />
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] leading-snug text-muted-foreground">{t('hint')}</p>
            <Button
              size="sm"
              onClick={submit}
              disabled={!text.trim() || saving}
              className="shrink-0 bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
              {t('save')}
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{t('readOnly')}</p>
      )}

      {loading ? (
        <div className="flex justify-center py-4">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      ) : notes.length === 0 ? (
        <p className="py-3 text-center text-xs text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="space-y-2">
          {notes.map((note) => (
            <li key={note.id} className="group rounded-lg border border-border/50 bg-muted/50 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-foreground">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary-soft text-[10px] font-semibold text-primary">
                    {authorOf(note.user_id).charAt(0).toUpperCase()}
                  </span>
                  <span className="truncate">{authorOf(note.user_id)}</span>
                </span>
                {canSendMessages && (
                  <button
                    type="button"
                    onClick={() => remove(note.id)}
                    aria-label={t('delete')}
                    title={t('delete')}
                    className="shrink-0 cursor-pointer text-muted-foreground opacity-0 transition-all hover:text-red-400 focus:opacity-100 group-hover:opacity-100"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </div>
              <p className={cn('mt-1.5 whitespace-pre-wrap text-muted-foreground', bodyText)}>
                {splitBodyByMentions(note.note_text, note.mentioned_user_ids ?? [], roster).map(
                  (seg, i) => (
                    <Fragment key={i}>
                      {seg.mention ? (
                        <span className="rounded bg-primary/10 px-1 font-medium text-primary">
                          {seg.text}
                        </span>
                      ) : (
                        seg.text
                      )}
                    </Fragment>
                  ),
                )}
              </p>
              <p className="mt-1.5 text-[10px] text-muted-foreground/80">
                {new Date(note.created_at).toLocaleString(locale, {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
