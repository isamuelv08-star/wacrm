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

  return (
    <div
      className={`rounded-2xl border p-5 shadow-sm ${
        stale
          ? "border-red-500/40 bg-red-500/5"
          : "border-border bg-card"
      }`}
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
        <span
          className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold ${
            account.whatsappStatus === "connected"
              ? "bg-emerald-500/15 text-emerald-500"
              : "bg-muted text-muted-foreground"
          }`}
        >
          {account.whatsappStatus === "connected" ? (
            <CircleCheck className="h-3 w-3" />
          ) : (
            <CircleAlert className="h-3 w-3" />
          )}
          {account.whatsappStatus === "connected" ? "WhatsApp conectado" : "WhatsApp desconectado"}
        </span>
      </div>

      {stale && (
        <div className="mt-3 flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-500">
          <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
          {stale} — puede que el cliente dejó de usar el sistema
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Metric icon={MessageSquare} label="Mensajes hoy" value={account.messagesToday} />
        <Metric icon={Users} label="Conversaciones activas" value={account.activeConversations} />
        <Metric icon={UserPlus} label="Leads hoy" value={account.newLeadsToday} />
        <Metric icon={UserPlus} label="Leads esta semana" value={account.newLeadsWeek} />
        <Metric icon={Flame} label="Leads HOT" value={account.hotLeads} />
        <Metric
          icon={DollarSign}
          label="Pipeline abierto"
          value={formatCurrency(account.openPipelineValue, account.defaultCurrency)}
        />
      </div>
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof MessageSquare;
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-lg bg-muted/50 p-2.5">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <p className="mt-1 text-lg font-bold text-foreground">{value}</p>
    </div>
  );
}
