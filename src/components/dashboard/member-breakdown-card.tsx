'use client';

import { useTranslations } from 'next-intl';
import { ChevronRight, Users } from 'lucide-react';

import type { TeamMember } from '@/lib/dashboard/member-detail';
import { MemberDetailSheet } from './member-detail-sheet';

/**
 * Admin/owner-only dashboard roster — "el dueño ve a todo el equipo,
 * con la opción de entrar y ver el detalle completo de cada uno".
 * Replaces the old multiwhatsapp-only SellerBreakdownCard: this reads
 * every account member from `profiles` (loadTeamRoster,
 * member-detail.ts) instead of who owns a WhatsApp number, so it
 * shows up for a 'shared'-mode account too — the common case (one
 * shared number, several agents round-robin-assigned). Each row is
 * just a name + avatar-style initial; the real numbers (leads by
 * score, pipeline, sales) only load once a row's MemberDetailSheet is
 * opened, so this card stays cheap regardless of team size.
 */
export function MemberBreakdownCard({ members }: { members: TeamMember[] }) {
  const t = useTranslations('Dashboard.memberBreakdown');

  if (members.length === 0) return null;

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <Users className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">{t('cardTitle')}</h3>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{t('cardSubtitle')}</p>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {members.map((member) => (
          <MemberDetailSheet key={member.userId} member={member}>
            <div className="flex w-full items-center gap-3 rounded-xl border border-border p-3 text-left transition-colors hover:border-primary/40">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary">
                {member.name.charAt(0).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                {member.name}
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </div>
          </MemberDetailSheet>
        ))}
      </div>
    </div>
  );
}
