import { Users2, CreditCard, TrendingUp, UsersRound, CircleCheck, ShieldAlert } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { formatCurrency } from "@/lib/currency";
import { DEFAULT_CURRENCY } from "@/lib/currency";
import type { AgencyAggregateStats } from "@/lib/agency/overview";

/**
 * Top-of-panel stat row — the aggregate numbers an agency admin wants
 * before drilling into any one client: how many clients, how much
 * recurring revenue, how many seats across all of them, and how many
 * need attention right now. Pairs with `AgencyAccountCard` below it,
 * which is the per-client breakdown of the same underlying data.
 *
 * MRR is summed in `DEFAULT_CURRENCY` regardless of each account's own
 * `default_currency` — this panel has no exchange-rate source, so a
 * mixed-currency client base would understate/overstate this number.
 * Fine for a single-currency agency (the common case); worth revisiting
 * if that changes.
 */
export async function AgencyStatsBar({ stats }: { stats: AgencyAggregateStats }) {
  const t = await getTranslations("Agency.page");

  const tiles = [
    { icon: Users2, label: t("statTotalClients"), value: stats.totalClients.toLocaleString() },
    {
      icon: CreditCard,
      label: t("statActiveSubscriptions"),
      value: stats.activeSubscriptions.toLocaleString(),
    },
    {
      icon: TrendingUp,
      label: t("statMrr"),
      value: formatCurrency(stats.mrr, DEFAULT_CURRENCY),
    },
    { icon: UsersRound, label: t("statTotalUsers"), value: stats.totalUsers.toLocaleString() },
    {
      icon: CircleCheck,
      label: t("statWhatsappConnected"),
      value: stats.whatsappConnected.toLocaleString(),
    },
    {
      icon: ShieldAlert,
      label: t("statNeedsAttention"),
      value: stats.needsAttention.toLocaleString(),
      alert: stats.needsAttention > 0,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {tiles.map((tile) => (
        <div
          key={tile.label}
          className={`rounded-2xl border p-4 ${
            tile.alert
              ? "border-red-500/25 bg-red-500/[0.04]"
              : "border-border bg-card"
          }`}
        >
          <div
            className={`flex items-center gap-1.5 text-[11px] font-medium ${
              tile.alert ? "text-red-600 dark:text-red-400" : "text-muted-foreground"
            }`}
          >
            <tile.icon className="h-3.5 w-3.5" />
            {tile.label}
          </div>
          <p
            className={`mt-1.5 text-xl font-bold ${
              tile.alert ? "text-red-600 dark:text-red-400" : "text-foreground"
            }`}
          >
            {tile.value}
          </p>
        </div>
      ))}
    </div>
  );
}
