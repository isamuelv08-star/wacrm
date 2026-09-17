'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Link2, Trash2 } from 'lucide-react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import type { TeamMember } from '@/lib/dashboard/member-detail';
import type { TeamChatMessage as TeamChatMessageData } from '@/lib/team-chat/queries';
import { splitBodyByMentions } from '@/lib/team-chat/mentions';

export function TeamChatMessage({
  message,
  sender,
  roster,
  canDelete,
  onDelete,
  referencedContactName,
}: {
  message: TeamChatMessageData;
  sender: TeamMember | undefined;
  roster: TeamMember[];
  canDelete: boolean;
  onDelete: (id: string) => void;
  referencedContactName: string | null;
}) {
  const t = useTranslations('TeamChat.message');
  const locale = useLocale();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const segments = splitBodyByMentions(message.body, message.mentionedUserIds, roster);
  const time = new Date(message.createdAt).toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="group flex items-start gap-2.5 px-1 py-1.5 hover:bg-muted/30">
      <Avatar size="sm" className="mt-0.5 shrink-0">
        {sender?.avatarUrl ? <AvatarImage src={sender.avatarUrl} alt="" /> : null}
        <AvatarFallback className="bg-primary/10 text-xs text-primary">
          {(sender?.name ?? '?').charAt(0).toUpperCase()}
        </AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm font-medium text-foreground">
            {sender?.name ?? t('unknownMember')}
          </span>
          <span className="shrink-0 text-[11px] text-muted-foreground">{time}</span>
        </div>

        <p className="mt-0.5 text-sm whitespace-pre-wrap break-words text-foreground">
          {segments.map((seg, i) =>
            seg.mention ? (
              <span key={i} className="rounded bg-primary/10 px-1 font-medium text-primary">
                @{seg.mention.name}
              </span>
            ) : (
              <span key={i}>{seg.text}</span>
            ),
          )}
        </p>

        {message.referencedConversationId && (
          <Link
            href={`/inbox?c=${message.referencedConversationId}`}
            className="mt-1.5 inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted/50 px-2.5 py-1.5 text-xs text-foreground transition-colors hover:border-primary/40 hover:bg-muted"
          >
            <Link2 className="size-3.5 text-primary" />
            {referencedContactName ?? t('viewConversation')}
          </Link>
        )}
      </div>

      {canDelete && (
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          className="shrink-0 rounded-md p-1 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive"
          aria-label={t('deleteAction')}
          title={t('deleteAction')}
        >
          <Trash2 className="size-3.5" />
        </button>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t('deleteConfirmTitle')}
        confirmLabel={t('deleteAction')}
        cancelLabel={t('cancel')}
        onConfirm={() => {
          setConfirmOpen(false);
          onDelete(message.id);
        }}
        variant="destructive"
      />
    </div>
  );
}
