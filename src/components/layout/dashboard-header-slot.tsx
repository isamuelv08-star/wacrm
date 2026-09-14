"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

// ============================================================
// Lets the Dashboard page's own PeriodSelector (local state: preset /
// customStart / customEnd / handlers, all owned by that page) render
// INSIDE the shared top Header bar, on the same line as "Bienvenido,
// {name}" and the account menu — instead of Header having to know
// anything about period-selection state, or the page having to
// duplicate the account-menu chrome.
//
// Header mounts a plain <div ref={setSlotEl}> when it's showing the
// dashboard's compact layout; the Dashboard page portals its
// <PeriodSelector> into that node via `useDashboardHeaderSlot().slotEl`.
// Both live under the same provider (DashboardShellInner), so the slot
// element is set before the page's own effects run.
// ============================================================

interface DashboardHeaderSlotContextValue {
  slotEl: HTMLDivElement | null;
  setSlotEl: (el: HTMLDivElement | null) => void;
}

const DashboardHeaderSlotContext = createContext<DashboardHeaderSlotContextValue | null>(null);

export function DashboardHeaderSlotProvider({ children }: { children: ReactNode }) {
  const [slotEl, setSlotEl] = useState<HTMLDivElement | null>(null);
  return (
    <DashboardHeaderSlotContext.Provider value={{ slotEl, setSlotEl }}>
      {children}
    </DashboardHeaderSlotContext.Provider>
  );
}

export function useDashboardHeaderSlot(): DashboardHeaderSlotContextValue {
  const ctx = useContext(DashboardHeaderSlotContext);
  if (!ctx) {
    throw new Error("useDashboardHeaderSlot must be used within DashboardHeaderSlotProvider");
  }
  return ctx;
}
