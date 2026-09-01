import {
  CircleCheck,
  CircleAlert,
  MessageSquare,
  Users,
  Flame,
  DollarSign,
  UserPlus,
  Clock,
} from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/currency";
import type {
  AgencyAccountOverview,
  WhatsAppConnectionMethod,
} from "@/lib/agency/overview";

function formatDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export async function AgencyAccountCard({ account }: { account: AgencyAccountOverview }) {
  const t = await getTranslations("Agency.card");
  const locale = await getLocale();
  const staleness = account.staleness;
  const stale = !staleness
    ? null
    : "neverActive" in staleness
      ? t("staleNoActivity")
      : t("staleDays", { count: staleness.daysSinceActivity });
  const connected = account.whatsappStatus === "connected";
  const methodLabel = connectionMethodLabel(account.whatsappConnectionMethod, t);

  return (
    <div
      className={cn(
        "rounded-2xl border bg-card p-5 shadow-sm transition-colors",
        // Semantic severity, not the brand accent — a disconnected
        // channel means leads stop reaching the client regardless of
        // which color theme the panel happens to be set to.
        !connected && "border-red-500/25 bg-red-500/[0.03]",
        connected && stale && "border-amber-500/25 bg-amber-500/[0.03]",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h3 className="truncate text-base font-semibold text-foreground">
              {account.accountName}
            </h3>
            {account.neverUsed && (
              <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                {t("neverUsed")}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t("clientSince", { date: formatDate(account.accountCreatedAt, locale) })}
            {" · "}
            {t("memberCount", { count: account.memberCount })}
          </p>
        </div>
        {/* Connected reads as a quiet, informational green (with the
            connection method as a sub-label — Meta / Coexistencia /
            Zernio all count); disconnected is a real alert, solid red.
            Neither is tied to the panel's brand accent color, so this
            always reads the same regardless of theme. */}
        <span
          className={cn(
            "inline-flex shrink-0 flex-col items-end gap-0.5 rounded-xl px-2.5 py-1 text-right text-[11px] font-semibold",
            connected
              ? "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400"
              : "bg-red-500/12 text-red-600 dark:text-red-400",
          )}
        >
          <span className="inline-flex items-center gap-1">
            {connected ? <CircleCheck className="h-3 w-3" /> : <CircleAlert className="h-3 w-3" />}
            {connected ? t("whatsappConnected") : t("whatsappDisconnected")}
          </span>
          {connected && methodLabel && (
            <span className="text-[10px] font-medium opacity-70">{methodLabel}</span>
          )}
        </span>
      </div>

      {stale && (
        <div className="mt-3 flex items-center gap-1.5 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-600 dark:text-amber-400">
          <Clock className="h-3.5 w-3.5 shrink-0" />
          {stale} {t("staleSuffix")}
        </div>
      )}

      {/* Hero row — Leads HOT and Pipeline abierto are the two numbers
          that matter for a quick go/no-go read on an account, so they
          get real size instead of sharing the grid evenly with the
          other four. */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <HeroMetric
          icon={Flame}
          label={t("hotLeads")}
          value={account.hotLeads}
          emphasize={account.hotLeads > 0}
        />
        <HeroMetric
          icon={DollarSign}
          label={t("openPipeline")}
          value={formatCurrency(account.openPipelineValue, account.defaultCurrency)}
        />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <MiniMetric icon={MessageSquare} label={t("messagesToday")} value={account.messagesToday} />
        <MiniMetric icon={Users} label={t("activeConversations")} value={account.activeConversations} />
        <MiniMetric icon={UserPlus} label={t("leadsToday")} value={account.newLeadsToday} />
        <MiniMetric icon={UserPlus} label={t("leadsWeek")} value={account.newLeadsWeek} />
      </div>
    </div>
  );
}

function connectionMethodLabel(
  method: WhatsAppConnectionMethod,
  t: Awaited<ReturnType<typeof getTranslations<"Agency.card">>>,
): string | null {
  switch (method) {
    case "meta":
      return t("connectionMeta");
    case "coexistence":
      return t("connectionCoexistence");
    case "zernio":
      return t("connectionZernio");
    default:
      return null;
  }
}

/**
 * Leads HOT / Pipeline abierto — the two hero tiles. `emphasize` tints
 * the HOT tile in the same red/flame vocabulary as LeadScoreBadge's
 * "hot" style elsewhere in the app ("0" is good news, not something to
 * flag). Pipeline value always stays neutral — money isn't a warning.
 * Deliberately not tied to `--primary`: that token is the panel's
 * pickable accent color, and severity here needs to read the same
 * regardless of which accent is active.
 */
function HeroMetric({
  icon: Icon,
  label,
  value,
  emphasize,
}: {
  icon: typeof MessageSquare;
  label: string;
  value: string | number;
  emphasize?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border p-3.5",
        emphasize ? "border-red-500/15 bg-red-500/[0.06]" : "border-transparent bg-muted/40",
      )}
    >
      <div
        className={cn(
          "flex items-center gap-1.5 text-[11px] font-medium",
          emphasize ? "text-red-600/80 dark:text-red-400/80" : "text-muted-foreground",
        )}
      >
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <p
        className={cn(
          "mt-1.5 text-2xl font-bold",
          emphasize ? "text-red-600 dark:text-red-400" : "text-foreground",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function MiniMetric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof MessageSquare;
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-lg bg-muted/40 px-2.5 py-2">
      <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
        <Icon className="h-2.5 w-2.5" />
        {label}
      </div>
      <p className="mt-0.5 text-sm font-semibold text-foreground">{value}</p>
    </div>
  );
}
