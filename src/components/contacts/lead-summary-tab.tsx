'use client';

import type { ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  ArrowRight,
  HandCoins,
  Layers,
  Loader2,
  Megaphone,
  MessageSquareMore,
  Package,
  RefreshCw,
  Sparkles,
  Target,
  TriangleAlert,
  UserRound,
  Wallet,
} from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';
import { formatCurrency } from '@/lib/currency';
import type { LeadProfile } from '@/lib/contacts/lead-profile';
import { useLeadSummary, type SummaryStatus } from '@/hooks/use-lead-summary';
import { LEAD_SCORE_STYLES } from '@/components/leads/lead-score-badge';
import { cn } from '@/lib/utils';
import type { Contact } from '@/types';

export type { SummaryStatus };

const CHANNEL_LABEL: Record<string, string> = {
  whatsapp: 'WhatsApp',
  messenger: 'Messenger',
  instagram: 'Instagram',
};

/** "hace 3 horas" / "3 hours ago" in the UI language. */
function relativeTime(iso: string, locale: string): string {
  const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];
  for (const [unit, size] of steps) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
  }
  return rtf.format(0, 'second');
}

function shortDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
}

function Section({
  icon,
  title,
  aside,
  children,
}: {
  icon: ReactNode;
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-3.5">
      <header className="mb-2.5 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {icon}
          {title}
        </h3>
        {aside}
      </header>
      {children}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>;
}

// ------------------------------------------------------------
// Presentational view — pure props in, markup out.
// ------------------------------------------------------------

export function LeadSummaryView({
  contact,
  profile,
  status,
  canRefresh,
  onRefresh,
  defaultCurrency,
}: {
  contact: Pick<Contact, 'lead_score' | 'lead_score_reason' | 'lead_score_updated_at'>;
  profile: LeadProfile;
  status: SummaryStatus;
  canRefresh: boolean;
  onRefresh: () => void;
  defaultCurrency: string;
}) {
  const t = useTranslations('LeadSummary');
  const tLeads = useTranslations('Leads');
  const locale = useLocale();

  const { summary, intelligence, deals, promises, activity, tags, scoreTrend } = profile;
  const generating = status === 'generating';
  const score = contact.lead_score ?? null;
  const ScoreIcon = score ? LEAD_SCORE_STYLES[score].icon : null;

  const openDeals = deals.filter((d) => d.status === 'open');
  const currencies = new Set(openDeals.map((d) => d.currency || defaultCurrency));
  const openTotal =
    openDeals.length > 1 && currencies.size === 1
      ? formatCurrency(
          openDeals.reduce((sum, d) => sum + d.value, 0),
          [...currencies][0],
        )
      : null;

  const needItems = intelligence
    ? [
        { key: 'need', icon: Target, label: t('need'), value: intelligence.need },
        { key: 'budget', icon: Wallet, label: t('budget'), value: intelligence.budget },
        { key: 'objection', icon: TriangleAlert, label: t('objection'), value: intelligence.objection },
        { key: 'product', icon: Package, label: t('productInterest'), value: intelligence.productInterest },
      ]
    : [];

  return (
    <div className="space-y-3">
      {/* ---------- AI executive summary ---------- */}
      <Section
        icon={<Sparkles className="size-3.5 text-primary" />}
        title={t('executiveSummary')}
        aside={
          <button
            type="button"
            onClick={onRefresh}
            disabled={!canRefresh || generating}
            title={t('refresh')}
            aria-label={t('refresh')}
            className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
          >
            <RefreshCw className={cn('size-3.5', generating && 'animate-spin')} />
          </button>
        }
      >
        {summary ? (
          <div className="space-y-3">
            <p className="text-sm leading-relaxed text-foreground">{summary.summary}</p>
            {summary.highlights.length > 0 && (
              <ul className="space-y-1.5">
                {summary.highlights.map((h, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
                    <span>{h}</span>
                  </li>
                ))}
              </ul>
            )}
            {summary.next_step && (
              <div className="rounded-lg border border-primary/25 bg-primary/5 p-2.5">
                <p className="mb-0.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-primary">
                  <ArrowRight className="size-3" />
                  {t('nextStep')}
                </p>
                <p className="text-xs text-foreground">{summary.next_step}</p>
              </div>
            )}
            <p className="text-[10px] text-muted-foreground/80">
              {generating ? t('updating') : t('generated', { time: relativeTime(summary.generated_at, locale) })}
              {' · '}
              {t('aiDisclaimer')}
            </p>
          </div>
        ) : generating ? (
          <div className="space-y-2" aria-busy="true">
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              {t('analyzing')}
            </p>
            <div className="h-3 w-full animate-pulse rounded bg-muted" />
            <div className="h-3 w-11/12 animate-pulse rounded bg-muted" />
            <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
          </div>
        ) : status === 'not_configured' ? (
          <Empty>{t('notConfigured')}</Empty>
        ) : status === 'no_messages' ? (
          <Empty>{t('noMessages')}</Empty>
        ) : status === 'no_permission' ? (
          <Empty>{t('noPermission')}</Empty>
        ) : status === 'error' ? (
          <div className="space-y-2">
            <Empty>{t('failed')}</Empty>
            {canRefresh && (
              <button
                type="button"
                onClick={onRefresh}
                className="text-xs font-medium text-primary hover:underline"
              >
                {t('retry')}
              </button>
            )}
          </div>
        ) : (
          <Empty>{t('noMessages')}</Empty>
        )}
      </Section>

      {/* ---------- Score ---------- */}
      <Section icon={<Target className="size-3.5" />} title={t('score')}>
        {score && ScoreIcon ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold',
                  LEAD_SCORE_STYLES[score].className,
                )}
              >
                <ScoreIcon className="size-3.5" />
                {tLeads(score)}
              </span>
              {contact.lead_score_updated_at && (
                <span className="text-[11px] text-muted-foreground">
                  {t('assessed', { time: relativeTime(contact.lead_score_updated_at, locale) })}
                </span>
              )}
            </div>
            {contact.lead_score_reason && (
              <p className="text-xs leading-relaxed text-muted-foreground">{contact.lead_score_reason}</p>
            )}
            {scoreTrend.length > 1 && (
              <p className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                <span className="font-medium text-foreground">{t('trend')}:</span>
                {scoreTrend.map((s, i) => (
                  <span key={`${s.at}-${i}`} className="inline-flex items-center gap-1">
                    {i > 0 && <ArrowRight className="size-3" />}
                    {tLeads(s.score)}
                  </span>
                ))}
              </p>
            )}
          </div>
        ) : (
          <Empty>{t('unscored')}</Empty>
        )}
      </Section>

      {/* ---------- Need / budget / objection / product ---------- */}
      <Section icon={<Package className="size-3.5" />} title={t('leadNeeds')}>
        {intelligence ? (
          <div className="space-y-2.5">
            <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {needItems.map(({ key, icon: Icon, label, value }) => (
                <div key={key} className="rounded-lg bg-muted/50 p-2.5">
                  <dt className="mb-0.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <Icon className="size-3" />
                    {label}
                  </dt>
                  <dd className={cn('text-xs', value ? 'text-foreground' : 'text-muted-foreground/60')}>
                    {value ?? t('notStated')}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="text-[10px] text-muted-foreground/80">
              {t('needsSource', { date: shortDate(intelligence.updatedAt, locale) })}
            </p>
          </div>
        ) : (
          <Empty>{t('needsEmpty')}</Empty>
        )}
      </Section>

      {/* ---------- Pipeline ---------- */}
      <Section
        icon={<Layers className="size-3.5" />}
        title={t('pipeline')}
        aside={
          openTotal ? (
            <span className="text-[11px] text-muted-foreground">
              {t('openValue')}: <span className="font-semibold text-foreground">{openTotal}</span>
            </span>
          ) : undefined
        }
      >
        {deals.length === 0 ? (
          <Empty>{t('noDeals')}</Empty>
        ) : (
          <ul className="space-y-1.5">
            {deals.map((d) => (
              <li
                key={d.id}
                className="flex items-center justify-between gap-2 rounded-lg bg-muted/50 px-2.5 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-foreground">{d.title}</p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    {d.stageName && <span>{d.stageName}</span>}
                    <span
                      className={cn(
                        'rounded px-1 py-px font-medium',
                        d.status === 'won' && 'bg-emerald-500/15 text-emerald-500',
                        d.status === 'lost' && 'bg-red-500/15 text-red-500',
                        d.status === 'open' && 'bg-muted text-muted-foreground',
                      )}
                    >
                      {t(`deal.${d.status}`)}
                    </span>
                  </p>
                </div>
                <span className="shrink-0 text-xs font-semibold text-foreground">
                  {formatCurrency(d.value, d.currency || defaultCurrency)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* ---------- Commitments ---------- */}
      <Section icon={<HandCoins className="size-3.5" />} title={t('commitments')}>
        {promises.length === 0 ? (
          <Empty>{t('noCommitments')}</Empty>
        ) : (
          <ul className="space-y-1.5">
            {promises.map((p) => (
              <li key={p.id} className="rounded-lg bg-muted/50 px-2.5 py-2">
                <p className="text-xs text-foreground">{p.text}</p>
                <p
                  className={cn(
                    'mt-0.5 text-[10px]',
                    p.overdue ? 'font-medium text-red-500' : 'text-muted-foreground',
                  )}
                >
                  {p.overdue ? t('overdue') : t('due')} · {shortDate(p.dueAt, locale)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* ---------- Activity ---------- */}
      <Section icon={<MessageSquareMore className="size-3.5" />} title={t('activity')}>
        {activity.conversationCount === 0 ? (
          <Empty>{t('noActivity')}</Empty>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: t('received'), value: activity.inbound },
                { label: t('sent'), value: activity.outbound },
                { label: t('conversations'), value: activity.conversationCount },
              ].map((s) => (
                <div key={s.label} className="rounded-lg bg-muted/50 p-2 text-center">
                  <p className="text-base font-semibold text-foreground">{s.value}</p>
                  <p className="text-[10px] text-muted-foreground">{s.label}</p>
                </div>
              ))}
            </div>
            <dl className="space-y-1.5 text-xs">
              {(
                [
                  [t('firstContact'), activity.firstMessageAt ? shortDate(activity.firstMessageAt, locale) : null],
                  [
                    t('lastCustomerMessage'),
                    activity.lastCustomerMessageAt ? relativeTime(activity.lastCustomerMessageAt, locale) : null,
                  ],
                  [t('channel'), activity.channels.map((c) => CHANNEL_LABEL[c] ?? c).join(', ') || null],
                ] as [string, string | null][]
              )
                .filter(([, v]) => v)
                .map(([label, value]) => (
                  <div key={label} className="flex items-baseline justify-between gap-3">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="text-right font-medium text-foreground">{value}</dd>
                  </div>
                ))}
              <div className="flex items-baseline justify-between gap-3">
                <dt className="flex items-center gap-1 text-muted-foreground">
                  <UserRound className="size-3" />
                  {t('owner')}
                </dt>
                <dd className="text-right font-medium text-foreground">
                  {activity.assignedAgentName ?? <span className="text-muted-foreground/60">{t('unassigned')}</span>}
                </dd>
              </div>
              {activity.adHeadline && (
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="flex items-center gap-1 text-muted-foreground">
                    <Megaphone className="size-3" />
                    {t('origin')}
                  </dt>
                  <dd className="text-right font-medium text-foreground">{activity.adHeadline}</dd>
                </div>
              )}
            </dl>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {tags.map((tag) => (
                  <span
                    key={tag.id}
                    className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                    style={{ backgroundColor: `${tag.color}20`, color: tag.color }}
                  >
                    {tag.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </Section>
    </div>
  );
}

// ------------------------------------------------------------
// Container — loads the profile, asks the server for the AI
// narrative only when it is missing or stale.
// ------------------------------------------------------------

export function LeadSummaryTab({ contact }: { contact: Contact }) {
  const { defaultCurrency } = useAuth();
  const t = useTranslations('LeadSummary');
  const { profile, loadError, status, canRefresh, refresh } = useLeadSummary(contact);

  if (loadError) return <p className="py-8 text-center text-sm text-muted-foreground">{t('loadError')}</p>;
  if (!profile) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <LeadSummaryView
      contact={contact}
      profile={profile}
      status={status}
      canRefresh={canRefresh}
      onRefresh={refresh}
      defaultCurrency={defaultCurrency}
    />
  );
}
