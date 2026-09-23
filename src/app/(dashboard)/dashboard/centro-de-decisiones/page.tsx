import { redirect } from "next/navigation";
import { requireRole, UnauthorizedError, ForbiddenError } from "@/lib/auth/account";
import { DecisionCenterView } from "@/components/decision-center/decision-center-view";

// ============================================================
// Centro de Decisiones — exclusive to admin+ (manager/owner).
//
// Unlike every other page under (dashboard) (all Client Components,
// gated only client-side via useAuth()), this ONE is a Server
// Component that calls requireRole('admin') itself, BEFORE anything
// renders, and redirects server-side on failure — same
// `createClient()` (@/lib/supabase/server) + `redirect()`
// (next/navigation) pattern src/app/page.tsx already uses for its own
// auth check, just with a role floor added. A seller who knows this
// URL never gets a React tree to inspect: the server response IS the
// redirect, nothing from this page's data or markup is ever sent to
// them. Every underlying query this page's content calls is ALSO
// already `requireRole('admin')`-gated in its own API route (defense
// in depth, not the only gate) — this page-level check is what was
// missing across the whole app until now; existing pages keep their
// client-only gating unchanged, this pattern is scoped to this one
// route because it's the one explicitly asked to never even flash for
// an unauthorized visitor.
// ============================================================

export default async function DecisionCenterPage() {
  try {
    await requireRole("admin");
  } catch (err) {
    if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
      redirect("/dashboard");
    }
    throw err;
  }

  return <DecisionCenterView />;
}
