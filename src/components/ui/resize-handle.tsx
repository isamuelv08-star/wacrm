"use client";

import { cn } from "@/lib/utils";

/**
 * A draggable vertical divider between two side-by-side panels. The
 * visible line is 1px, centred inside a wider (10px) invisible hit
 * area — a mouse-precision affordance every resizable-panel UI uses
 * (VS Code, Slack, ...), since a bare 1px target is nearly impossible
 * to grab reliably.
 *
 * Purely presentational — `onPointerDown` and `resizing` come from
 * `useResizablePanel`, which owns the actual width math.
 */
export function ResizeHandle({
  onPointerDown,
  onDoubleClick,
  resizing,
  label,
}: {
  onPointerDown: (e: React.PointerEvent) => void;
  /** Double-click resets the panel to its default width. */
  onDoubleClick?: () => void;
  resizing: boolean;
  /** Accessible name — the panel this handle resizes. */
  label: string;
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      className="group relative z-10 flex w-2.5 shrink-0 cursor-col-resize touch-none select-none items-stretch justify-center"
    >
      <div
        className={cn(
          "w-px bg-border transition-colors group-hover:bg-primary",
          resizing && "bg-primary",
        )}
      />
    </div>
  );
}
