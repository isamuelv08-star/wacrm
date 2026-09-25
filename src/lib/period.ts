import { dayKeyInTimezone, localDateTimeToUtcIso } from "@/lib/ai/timezone";
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
  | "last15Days"
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
    case "last15Days": {
      const start = addDays(startOfDay(now), -14);
      return { start, end: addDays(startOfDay(now), 1), label: "last15Days" };
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
    case "last15Days":
    case "last30Days":
    case "custom": {
      const inclusiveEnd = new Date(range.end.getTime() - 1);
      return `${range.start.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${inclusiveEnd.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
    }
  }
}

/**
 * Query string for /api/dashboard/ceo-summary: the preset label plus
 * the range's exact bounds, computed HERE in the viewer's browser
 * timezone. The server runs in UTC (node:20-alpine) and used to
 * recompute "today" / "this month" there — so for a business in
 * Ecuador (UTC-5) "today" ran 19:00→19:00 and sales on the last
 * evening of the month counted toward the next month.
 */
export function ceoSummaryRangeParams(range: PeriodRange): URLSearchParams {
  return new URLSearchParams({
    preset: range.label,
    from: range.start.toISOString(),
    to: range.end.toISOString(),
  });
}

/**
 * Server side of `ceoSummaryRangeParams`: the client's exact bounds
 * when present and sane, else null (caller falls back to computing the
 * preset itself). Bounded to a sensible span so a crafted request
 * can't ask for a decade-long scan.
 */
export function parseClientRange(
  label: PeriodPreset,
  from: string | null,
  to: string | null,
): PeriodRange | null {
  if (!from || !to) return null;
  const start = new Date(from);
  const end = new Date(to);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  const spanDays = (end.getTime() - start.getTime()) / 86_400_000;
  if (spanDays <= 0 || spanDays > 366 * 10) return null;
  return { start, end, label };
}

/**
 * `rangeForPreset`, but with day/week/month boundaries at local
 * midnight in `timezone` (the account's `accounts.timezone`) instead
 * of the process's own zone. For server-side callers with no browser
 * behind them (decision center, AI assistant snapshot, risk-engine
 * cron): the container runs in UTC, so "this month" for a UTC-5
 * business used to start at 19:00 on the last day of the previous
 * month. 'custom' has no meaning without explicit bounds and falls
 * back to `rangeForPreset`.
 */
export function rangeForPresetInTimezone(
  preset: PeriodPreset,
  timezone: string,
  now: Date = new Date(),
): PeriodRange {
  if (preset === "custom") return rangeForPreset(preset);

  const [y, m, d] = dayKeyInTimezone(now, timezone).split("-").map(Number);
  // Local midnight of a (possibly overflowing) calendar date in `timezone`.
  const at = (yy: number, mm: number, dd: number): Date => {
    const key = new Date(Date.UTC(yy, mm - 1, dd)).toISOString().slice(0, 10);
    return new Date(localDateTimeToUtcIso(`${key}T00:00`, timezone) ?? `${key}T00:00:00Z`);
  };
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  const mondayOffset = (weekday + 6) % 7;

  switch (preset) {
    case "today":
      return { start: at(y, m, d), end: at(y, m, d + 1), label: preset };
    case "yesterday":
      return { start: at(y, m, d - 1), end: at(y, m, d), label: preset };
    case "last7Days":
      return { start: at(y, m, d - 6), end: at(y, m, d + 1), label: preset };
    case "last15Days":
      return { start: at(y, m, d - 14), end: at(y, m, d + 1), label: preset };
    case "last30Days":
      return { start: at(y, m, d - 29), end: at(y, m, d + 1), label: preset };
    case "thisWeek":
      return { start: at(y, m, d - mondayOffset), end: at(y, m, d - mondayOffset + 7), label: preset };
    case "lastWeek":
      return { start: at(y, m, d - mondayOffset - 7), end: at(y, m, d - mondayOffset), label: preset };
    case "thisMonth":
      return { start: at(y, m, 1), end: at(y, m + 1, 1), label: preset };
    case "lastMonth":
      return { start: at(y, m - 1, 1), end: at(y, m, 1), label: preset };
    case "thisQuarter": {
      const qm = Math.floor((m - 1) / 3) * 3 + 1;
      return { start: at(y, qm, 1), end: at(y, qm + 3, 1), label: preset };
    }
    case "thisYear":
      return { start: at(y, 1, 1), end: at(y + 1, 1, 1), label: preset };
    case "allTime":
      return { start: at(2020, 1, 1), end: at(y + 1, 1, 1), label: preset };
  }
}
