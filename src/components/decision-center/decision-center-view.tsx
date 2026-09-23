"use client";

// ============================================================
// Centro de Decisiones — client-side content. The role gate already
// happened server-side in page.tsx before this ever mounted; nothing
// here re-checks it (client-side role checks elsewhere in the app,
// e.g. useAuth()'s canViewDashboardSection, exist to hide/show WIDGETS
// within an already-accessible page — this page's very existence is
// the thing being gated, at the server, once).
//
// Stage 1 (this commit): placeholder only, to verify the server-side
// gate end to end before any content is built. Filled in stage by
// stage per the approved plan — each stage adds one section, tested
// on its own before the next one starts.
// ============================================================

export function DecisionCenterView() {
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Centro de Decisiones</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          La situación de tu negocio, explicada y priorizada para tomar acción.
        </p>
      </div>
    </div>
  );
}
