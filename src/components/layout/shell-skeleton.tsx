import { cn } from "@/lib/utils";

const bar = "animate-pulse rounded-lg bg-muted";

/**
 * The dashboard's frame drawn as placeholders — floating sidebar, top
 * bar and a content area — shown while the session resolves on a fresh
 * load. It replaces a centered spinner on an empty screen: the layout is
 * already where it will be, so when the real shell mounts nothing jumps,
 * and the wait reads as "loading" rather than "blank".
 *
 * Mirrors the real shell's geometry (layout/sidebar.tsx, layout/header.tsx,
 * dashboard-shell.tsx); keep the two in step if those change. Purely
 * presentational and server-renderable, so it can paint before any JS runs.
 */
export function ShellSkeleton({ label }: { label?: string }) {
  return (
    <div
      className="flex h-screen overflow-hidden bg-background"
      role="status"
      aria-busy="true"
    >
      {label ? <span className="sr-only">{label}</span> : null}

      <aside
        aria-hidden
        className={cn(
          "m-3 hidden h-[calc(100%-1.5rem)] w-60 shrink-0 flex-col gap-2 p-3 lg:flex",
          "rounded-2xl border border-border bg-card shadow-lg shadow-black/5",
        )}
      >
        <div className={cn(bar, "mb-3 h-8 w-36")} />
        {Array.from({ length: 9 }, (_, i) => (
          <div key={i} className={cn(bar, "h-9 bg-muted/60")} />
        ))}
        <div className="mt-auto flex items-center gap-2">
          <div className={cn(bar, "size-9 rounded-full")} />
          <div className={cn(bar, "h-4 w-24")} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden" aria-hidden>
        <div className="flex h-14 shrink-0 items-center gap-3 px-4 lg:px-6">
          <div className={cn(bar, "h-9 w-full max-w-md")} />
          <div className="ml-auto flex items-center gap-2">
            <div className={cn(bar, "size-9 rounded-full")} />
            <div className={cn(bar, "size-9 rounded-full")} />
          </div>
        </div>

        <main className="flex-1 space-y-6 overflow-hidden p-4 sm:p-6">
          <div className="flex items-center justify-between">
            <div className={cn(bar, "h-8 w-56")} />
            <div className={cn(bar, "h-9 w-28")} />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className={cn(bar, "h-28 bg-muted/50")} />
            ))}
          </div>
          <div className={cn(bar, "h-72 bg-muted/40")} />
        </main>
      </div>
    </div>
  );
}
