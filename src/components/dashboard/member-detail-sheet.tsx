'use client'

// ============================================================
// MemberDetailSheet — click-through detail for one row of
// MemberBreakdownCard. Same "wrap the row as SheetTrigger, fetch on
// open" shape as the agency panel's AccountDetailSheet
// (src/components/agency/account-detail-sheet.tsx) — the established
// pattern in this codebase for "click a summary row, see a fuller
// floating breakdown" — just scoped to one team member's own
// performance (leads by score, pipeline, sales this month) instead of
// a whole cross-tenant account.
// ============================================================

import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Briefcase, DollarSign, Flame, Loader2, MessageSquare, Snowflake, Sun } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { formatCurrency } from '@/lib/currency';
import { loadMemberBreakdown, type MemberBreakdown, type TeamMember } from '@/lib/dashboard/member-detail';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';

export function MemberDetailSheet({ member, children }: { member: TeamMember; children: ReactNode }) {
  const t = useTranslations('Dashboard.memberBreakdown');
  const { defaultCurrency } = useAuth();

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<MemberBreakdown | null>(null);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next && !data) {
      setLoading(true);
      loadMemberBreakdown(createClient(), member)
        .then(setData)
        .catch((err) => console.error('[dashboard] member breakdown failed:', err))
        .finally(() => setLoading(false));
    }
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger
        render={
          <button
            type="button"
            className="block w-full cursor-pointer text-left"
            aria-label={t('openDetail', { name: member.name })}
          >
            {children}
          </button>
        }
      />

      <SheetContent
        side="right"
        className="overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-md"
      >
        <SheetHeader>
          <SheetTitle>{member.name}</SheetTitle>
          <SheetDescription>{t('subtitle')}</SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-6 overflow-y-auto px-4 pb-4">
          {loading && !data && (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          )}

          {data && (
            <>
              <section>
                <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  {t('leadsTitle')}
                </h3>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <ScoreTile icon={Flame} label={t('hot')} value={data.leadsHot} tone="hot" />
                  <ScoreTile icon={Sun} label={t('warm')} value={data.leadsWarm} tone="warm" />
                  <ScoreTile icon={Snowflake} label={t('cold')} value={data.leadsCold} tone="cold" />
                </div>
              </section>

              <section>
                <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  {t('salesTitle')}
                </h3>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <MetricTile
                    icon={DollarSign}
                    label={t('soldThisMonth')}
                    value={formatCurrency(data.soldThisMonth, defaultCurrency)}
                  />
                  <MetricTile
                    icon={Briefcase}
                    label={t('openPipeline')}
                    value={formatCurrency(data.openDealsValue, defaultCurrency)}
                    sub={t('openDealsCount', { count: data.openDealsCount })}
                  />
                </div>
              </section>

              <section>
                <MetricTile
                  icon={MessageSquare}
                  label={t('activeConversations')}
                  value={String(data.activeConversations)}
                />
              </section>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

const SCORE_TONE_CLASSES: Record<'hot' | 'warm' | 'cold', string> = {
  hot: 'border-red-500/25 bg-red-500/[0.05] text-red-600 dark:text-red-400',
  warm: 'border-amber-500/25 bg-amber-500/[0.05] text-amber-600 dark:text-amber-400',
  cold: 'border-blue-500/25 bg-blue-500/[0.05] text-blue-600 dark:text-blue-400',
};

function ScoreTile({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Flame;
  label: string;
  value: number;
  tone: 'hot' | 'warm' | 'cold';
}) {
  return (
    <div className={`rounded-xl border p-3 text-center ${SCORE_TONE_CLASSES[tone]}`}>
      <Icon className="mx-auto size-4" />
      <p className="mt-1.5 text-xl font-bold">{value}</p>
      <p className="text-[11px] font-medium opacity-80">{label}</p>
    </div>
  );
}

function MetricTile({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: typeof DollarSign;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-muted/40 p-3">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
        <Icon className="size-3.5" />
        {label}
      </div>
      <p className="mt-1.5 text-lg font-bold text-foreground">{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}
