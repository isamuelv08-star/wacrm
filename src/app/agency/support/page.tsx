import { notFound } from "next/navigation";
import { LifeBuoy } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { requireSuperAdmin } from "@/lib/auth/agency";
import { loadAgencySupportRequests } from "@/lib/agency/support-requests";
import { SupportRequestsList } from "@/components/agency/support-requests-list";

export const metadata = {
  title: "Support — Agency panel",
};

/**
 * Cross-account support inbox — every request a client submitted from
 * the "Contactar soporte" sidebar button (migration 098), regardless
 * of which account it came from. Same gate/stealth posture as
 * /agency/page.tsx: notFound() on any auth failure, never a redirect.
 */
export default async function AgencySupportPage() {
  try {
    await requireSuperAdmin();
  } catch {
    notFound();
  }

  const requests = await loadAgencySupportRequests();
  const t = await getTranslations("Agency.support");
  const openCount = requests.filter((r) => r.status === "open").length;

  return (
    <div className="p-4 sm:p-6">
      <div className="mx-auto max-w-4xl">
        <div className="flex items-center gap-2">
          <LifeBuoy className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold text-foreground">{t("title")}</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("subtitle", { count: openCount })}
        </p>

        <SupportRequestsList initialRequests={requests} />
      </div>
    </div>
  );
}
