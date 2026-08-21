import { notFound } from "next/navigation";
import { Building2 } from "lucide-react";
import { requireSuperAdmin } from "@/lib/auth/agency";
import { loadAgencyOverview } from "@/lib/agency/overview";
import { AgencyAccountCard } from "@/components/agency/agency-account-card";
import { CreateClientDialog } from "@/components/agency/create-client-dialog";

export const metadata = {
  title: "Panel de agencia",
};

/**
 * Cross-account overview for the agency owner — see
 * src/lib/auth/agency.ts and supabase/migrations/051_agency_overview.sql
 * for the security model. Deliberately outside the (dashboard) route
 * group: that layout assumes a single account (useAuth()) and builds
 * a per-account sidebar that doesn't apply here.
 *
 * `notFound()` (not a redirect) on any failure — logged-out and
 * logged-in-but-not-super-admin both resolve to a generic 404, so
 * nothing about this route's existence leaks to anyone probing it.
 */
export default async function AgencyPage() {
  try {
    await requireSuperAdmin();
  } catch {
    notFound();
  }

  const accounts = await loadAgencyOverview();

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="mx-auto max-w-6xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Building2 className="h-6 w-6 text-primary" />
              <h1 className="text-2xl font-bold text-foreground">Panel de agencia</h1>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Vista de todas las cuentas administradas — {accounts.length}{" "}
              {accounts.length === 1 ? "cliente" : "clientes"}.
            </p>
          </div>
          <CreateClientDialog />
        </div>

        {accounts.length === 0 ? (
          <div className="mt-8 rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            Todavía no hay cuentas dadas de alta.
          </div>
        ) : (
          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {accounts.map((account) => (
              <AgencyAccountCard key={account.accountId} account={account} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
