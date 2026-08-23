// Date-range presets for the Pipeline Analytics period selector. Pure
// date math, no component dependencies — mirrors the shape of
// src/lib/dashboard/date-utils.ts, but this domain needed a real
// arbitrary range (a month, a quarter, a custom pick) rather than a
// rolling "last N days" window, so it's its own small module instead
// of overloading that one.

export type PeriodPreset = "thisMonth" | "lastMonth" | "thisQuarter" | "thisYear" | "allTime" | "custom";

export interface PeriodRange {
  start: Date;
  /** Exclusive. */
  end: Date;
  label: PeriodPreset;
}

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function startOfQuarter(d: Date): Date {
  return new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1);
}

function startOfYear(d: Date): Date {
  return new Date(d.getFullYear(), 0, 1);
}

/**
 * Resolves a preset (or an explicit custom pair) into a concrete
 * `[start, end)` range plus a display label. `custom` is required
 * only when `preset === "custom"` — every other preset ignores it.
 */
export function rangeForPreset(preset: PeriodPreset, custom?: { start: Date; end: Date }): PeriodRange {
  const now = new Date();

  switch (preset) {
    case "thisMonth": {
      const start = startOfMonth(now);
      return { start, end: startOfMonth(new Date(start.getFullYear(), start.getMonth() + 1, 1)), label: "thisMonth" };
    }
    case "lastMonth": {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return { start, end: startOfMonth(now), label: "lastMonth" };
    }
    case "thisQuarter": {
      const start = startOfQuarter(now);
      return { start, end: new Date(start.getFullYear(), start.getMonth() + 3, 1), label: "thisQuarter" };
    }
    case "thisYear": {
      const start = startOfYear(now);
      return { start, end: new Date(start.getFullYear() + 1, 0, 1), label: "thisYear" };
    }
    case "allTime":
      // A concrete (if arbitrary) start rather than epoch zero — this
      // account's data can't predate the app itself, and a real date
      // keeps every downstream `new Date(x) >= start` comparison
      // uniform instead of special-casing "no filter" as null.
      return { start: new Date(2020, 0, 1), end: new Date(now.getFullYear() + 1, 0, 1), label: "allTime" };
    case "custom": {
      if (!custom) throw new Error("rangeForPreset('custom') requires the `custom` argument");
      // End is inclusive from the picker's perspective (the user
      // picked a last day, not a moment) — push it to the start of
      // the NEXT day so `< end` correctly includes everything on
      // that last day.
      const start = startOfDay(custom.start);
      const end = new Date(startOfDay(custom.end));
      end.setDate(end.getDate() + 1);
      return { start, end, label: "custom" };
    }
  }
}
