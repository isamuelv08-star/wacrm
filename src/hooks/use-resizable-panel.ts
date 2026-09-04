"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ============================================================
// Drag-to-resize width for one inbox panel (conversation list /
// contact sidebar). Desktop-only by convention of its callers — mobile
// keeps the single-pane layout untouched.
//
// Widths persist per-panel in localStorage (device-scoped, same
// posture as the sidebar-collapsed and contact-panel-open prefs), so
// an agent who drags the conversation list wider keeps that layout
// across reloads instead of it snapping back every time.
// ============================================================

interface UseResizablePanelOptions {
  storageKey: string;
  defaultWidth: number;
  min: number;
  max: number;
  /** Which side of the panel the drag handle sits on: "end" means
   *  dragging right/toward the far edge of the screen grows the panel
   *  (conversation list, handle on its right edge); "start" means
   *  dragging right SHRINKS it (contact sidebar, handle on its left
   *  edge, panel occupies the space to the handle's right). */
  handleEdge: "start" | "end";
}

interface UseResizablePanelResult {
  /** Current width in px. Starts at `defaultWidth` and is corrected to
   *  the stored value (if any) right after mount — deliberately not
   *  read from localStorage in the initializer, to avoid a hydration
   *  mismatch against the server-rendered default (same pattern as
   *  the sidebar-collapsed / contact-panel-open prefs elsewhere in
   *  this app). */
  width: number;
  /** True while a drag is in progress — callers use this to suppress
   *  the width's CSS transition during the drag itself (a transition
   *  fighting a mousemove-driven value feels laggy) and to highlight
   *  the handle. */
  resizing: boolean;
  /** Spread onto the handle element's onPointerDown. */
  onHandlePointerDown: (e: React.PointerEvent) => void;
  /** Resets to `defaultWidth` (bound to the handle's onDoubleClick). */
  reset: () => void;
}

export function useResizablePanel({
  storageKey,
  defaultWidth,
  min,
  max,
  handleEdge,
}: UseResizablePanelOptions): UseResizablePanelResult {
  const [width, setWidth] = useState(defaultWidth);
  const [resizing, setResizing] = useState(false);
  const dragStartXRef = useRef(0);
  const dragStartWidthRef = useRef(defaultWidth);

  useEffect(() => {
    try {
      const stored = Number(localStorage.getItem(storageKey));
      if (Number.isFinite(stored) && stored > 0) {
        setWidth(Math.min(max, Math.max(min, stored)));
      }
    } catch {
      // localStorage can throw in private-browsing / sandboxed contexts.
    }
    // Only ever read once, on mount — re-running this on min/max churn
    // would clobber a live drag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  const persist = useCallback(
    (next: number) => {
      try {
        localStorage.setItem(storageKey, String(next));
      } catch {
        // Best-effort — the width just resets to default next load.
      }
    },
    [storageKey],
  );

  const onHandlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      dragStartXRef.current = e.clientX;
      dragStartWidthRef.current = width;
      setResizing(true);
    },
    [width],
  );

  useEffect(() => {
    if (!resizing) return;

    function onPointerMove(e: PointerEvent) {
      const deltaX = e.clientX - dragStartXRef.current;
      const signedDelta = handleEdge === "end" ? deltaX : -deltaX;
      const next = Math.min(max, Math.max(min, dragStartWidthRef.current + signedDelta));
      setWidth(next);
    }
    function onPointerUp() {
      setResizing(false);
      // Read the latest width off the DOM-independent state via a
      // functional update so this always persists the final value,
      // not a stale closure over `width` from when the drag started.
      setWidth((current) => {
        persist(current);
        return current;
      });
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [resizing, handleEdge, min, max, persist]);

  const reset = useCallback(() => {
    setWidth(defaultWidth);
    persist(defaultWidth);
  }, [defaultWidth, persist]);

  return { width, resizing, onHandlePointerDown, reset };
}
