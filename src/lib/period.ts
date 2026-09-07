// Shared date-range presets — a real calendar period (a month, a
// quarter, a custom pick) rather than a rolling "last N days" window.
// Used by both the Pipeline Analytics period selector and the
// dashboard's global period selector, so component code that needs a
// concrete [start, end) range plus a display preset lives here once
// instead of two near-identical copies drifting apart.

export type PeriodPreset =
  | "today"
  | "yesterday"
  | "last7Days"
  | "last30Days"
  | "thisWeek"
  | "lastWeek"
  | "thisMonth"
  | "lastMonth"
  | "thisQuarter"
  | "thisYear"
  | "allTime"
  | "custom";

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

/** Monday-anchored week start, matching the calendar page's convention. */
function startOfWeekMonday(d: Date): Date {
  const start = startOfDay(d);
  const mondayOffset = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - mondayOffset);
  return start;
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}

/**
 * Resolves a preset (or an explicit custom pair) into a concrete
 * `[start, end)` range plus a display label. `custom` is required
 * only when `preset === "custom"` — every other preset ignores it.
 */
export function rangeForPreset(preset: PeriodPreset, custom?: { start: Date; end: Date }): PeriodRange {
  const now = new Date();

  switch (preset) {
    case "today": {
      const start = startOfDay(now);
      return { start, end: addDays(start, 1), label: "today" };
    }
    case "yesterday": {
      const start = addDays(startOfDay(now), -1);
      return { start, end: addDays(start, 1), label: "yesterday" };
    }
    case "last7Days": {
      // Inclusive of today — a 7-day window ending today, not yesterday.
      const start = addDays(startOfDay(now), -6);
      return { start, end: addDays(startOfDay(now), 1), label: "last7Days" };
    }
    case "last30Days": {
      const start = addDays(startOfDay(now), -29);
      return { start, end: addDays(startOfDay(now), 1), label: "last30Days" };
    }
    case "thisWeek": {
      const start = startOfWeekMonday(now);
      return { start, end: addDays(start, 7), label: "thisWeek" };
    }
    case "lastWeek": {
      const start = addDays(startOfWeekMonday(now), -7);
      return { start, end: startOfWeekMonday(now), label: "lastWeek" };
    }
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

/**
 * Human-readable display label for a resolved range — "August 2026",
 * "Q3 2026", a custom "Aug 1 – Aug 15, 2026" span, etc. `t` needs the
 * `preset*` keys for the presets with no natural date-derived label
 * (today, yesterday, this/last week, all time), so any translator over
 * the `Common.period` namespace works.
 */
export function formatRangeLabel(range: PeriodRange, t: (key: string) => string): string {
  switch (range.label) {
    case "today":
      return t("presetToday");
    case "yesterday":
      return t("presetYesterday");
    case "thisWeek":
      return t("presetThisWeek");
    case "lastWeek":
      return t("presetLastWeek");
    case "thisMonth":
    case "lastMonth":
      return range.start.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    case "thisQuarter":
      return `Q${Math.floor(range.start.getMonth() / 3) + 1} ${range.start.getFullYear()}`;
    case "thisYear":
      return String(range.start.getFullYear());
    case "allTime":
      return t("presetAllTime");
    case "last7Days":
    case "last30Days":
    case "custom": {
      const inclusiveEnd = new Date(range.end.getTime() - 1);
      return `${range.start.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${inclusiveEnd.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
    }
  }
}
