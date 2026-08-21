import {
  CircleCheck,
  CircleAlert,
  MessageSquare,
  Users,
  Flame,
  DollarSign,
  UserPlus,
  TriangleAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/currency";
import type { AgencyAccountOverview } from "@/lib/agency/overview";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function stalenessLabel(staleness: AgencyAccountOverview["staleness"]): string | null {
  if (!staleness) return null;
  if ("neverActive" in staleness) return "Sin actividad registrada";
  return `Sin actividad hace ${staleness.daysSinceActivity} ${
    staleness.daysSinceActivity === 1 ? "día" : "días"
  }`;
}

export function AgencyAccountCard({ account }: { account: AgencyAccountOverview }) {
  const stale = stalenessLabel(account.staleness);
  const connected = account.whatsappStatus === "connected";

  return (
    <div
      className={cn(
        "rounded-2xl border p-5 shadow-sm",
        account.hasAlert ? "border-primary/40 bg-primary/[0.04]" : "border-border bg-card",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold text-foreground">
            {account.accountName}
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Cliente desde {formatDate(account.accountCreatedAt)}
          </p>
        </div>
        {/* Connected reads as a quiet, informational green — disconnected
            is a real alert (a client not receiving leads), so it gets a
            solid brand-red fill instead of a neutral gray badge. */}
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold",
            connected
              ? "bg-emerald-500/12 text-emerald-500"
              : "bg-primary text-primary-foreground shadow-sm shadow-primary/30",
          )}
        >
          {connected ? <CircleCheck className="h-3 w-3" /> : <CircleAlert className="h-3 w-3" />}
          {connected ? "WhatsApp conectado" : "WhatsApp desconectado"}
        </span>
      </div>

      {stale && (
        <div className="mt-3 flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/8 px-3 py-2 text-xs font-medium text-primary">
          <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
          {stale} — puede que el cliente dejó de usar el sistema
        </div>
      )}

      {/* Hero row — Leads HOT and Pipeline abierto are the two numbers
          that matter for a quick go/no-go read on an account, so they
          get real size instead of sharing the grid evenly with the
          other four. */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <HeroMetric
          icon={Flame}
          label="Leads HOT"
          value={account.hotLeads}
          emphasize={account.hotLeads > 0}
        />
        <HeroMetric
          icon={DollarSign}
          label="Pipeline abierto"
          value={formatCurrency(account.openPipelineValue, account.defaultCurrency)}
          valueClassName="text-primary"
        />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <MiniMetric icon={MessageSquare} label="Mensajes hoy" value={account.messagesToday} />
        <MiniMetric icon={Users} label="Conv. activas" value={account.activeConversations} />
        <MiniMetric icon={UserPlus} label="Leads hoy" value={account.newLeadsToday} />
        <MiniMetric icon={UserPlus} label="Leads semana" value={account.newLeadsWeek} />
      </div>
    </div>
  );
}

/**
 * Leads HOT / Pipeline abierto — the two hero tiles. `emphasize` tints
 * the tile itself in brand red (only meaningful for HOT leads: "0" is
 * good news, not something to flag); `valueClassName` lets the number
 * alone carry brand color without implying an alert (Pipeline abierto
 * — money isn't a warning, it's just on-brand, same convention
 * deal-card.tsx already uses for deal value).
 */
function HeroMetric({
  icon: Icon,
  label,
  value,
  emphasize,
  valueClassName,
}: {
  icon: typeof MessageSquare;
  label: string;
  value: string | number;
  emphasize?: boolean;
  valueClassName?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border p-3.5",
        emphasize ? "border-primary/15 bg-primary/[0.06]" : "border-transparent bg-muted/40",
      )}
    >
      <div
        className={cn(
          "flex items-center gap-1.5 text-[11px] font-medium",
          emphasize ? "text-primary/80" : "text-muted-foreground",
        )}
      >
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <p
        className={cn(
          "mt-1.5 text-2xl font-bold",
          valueClassName ?? (emphasize ? "text-primary" : "text-foreground"),
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
