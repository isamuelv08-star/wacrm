import { startOfMonth, startOfWeek } from "date-fns";
import type { Deal } from "@/types";

// ============================================================
// Buckets a stage column's deals into individual "this week" cards
// plus collapsed weekly/monthly groups for older ones, so a stage
// that's been accumulating leads for months doesn't render as one
// endless flat list. Keys off `deal.created_at` (already in memory on
// every board load) rather than "time spent in this stage" — that
// would need a `deal_stage_history` query the board doesn't make.
// See pipeline-board.tsx's StageColumn for the consumer.
// ============================================================

/** Below this many deals, a week/month bucket renders its deal(s) as
 *  individual cards instead of collapsing into a group — bundling a
 *  single stray deal costs an extra click (expand, then open) for no
 *  space saved over just showing the card directly. */
export const MIN_GROUP_SIZE = 2;

export interface IndividualEntry {
  kind: "individual";
  deal: Deal;
}

export interface WeekGroupEntry {
  kind: "week-group";
  key: string;
  weekStart: Date;
  /** Exclusive. */
  weekEnd: Date;
  deals: Deal[];
  totalValue: number;
}

export interface MonthGroupEntry {
  kind: "month-group";
  key: string;
  monthStart: Date;
  deals: Deal[];
  totalValue: number;
}

export type DealGroupEntry = IndividualEntry | WeekGroupEntry | MonthGroupEntry;

function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}

function sumValue(deals: Deal[]): number {
  return deals.reduce((sum, d) => sum + Number(d.value || 0), 0);
}

/**
 * Buckets `deals` (any order) into, most-recent-first:
 *   1. every deal created this week (Monday-anchored) — always
 *      individual, never collapsed, since these aren't "stale" yet;
 *   2. one group per earlier week still within the current calendar
 *      month;
 *   3. one group per fully past calendar month — the whole month
 *      collapses into a single bucket regardless of its week count.
 * A bucket smaller than MIN_GROUP_SIZE is emitted as individual
 * entries instead of a group of one. Pure — sorts its own defensive
 * copy of `deals`, doesn't mutate or trust caller order.
 */
export function groupDealsByDate(deals: Deal[], now: Date = new Date()): DealGroupEntry[] {
  const sorted = [...deals].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  const thisWeekStart = startOfWeek(now, { weekStartsOn: 1 });
  const thisMonthStart = startOfMonth(now);

  const entries: DealGroupEntry[] = [];
  const weekBuckets = new Map<string, Deal[]>();
  const monthBuckets = new Map<string, Deal[]>();
  // Records each bucket's first-seen position — since `sorted` is
  // newest-first, that's already most-recent-bucket-first, so the
  // buckets below need no second sort once assembled.
  const bucketOrder: Array<{ kind: "week" | "month"; key: string }> = [];

  for (const deal of sorted) {
    const createdAt = new Date(deal.created_at);
    if (createdAt.getTime() >= thisWeekStart.getTime()) {
      entries.push({ kind: "individual", deal });
      continue;
    }
    if (createdAt.getTime() >= thisMonthStart.getTime()) {
      const key = startOfWeek(createdAt, { weekStartsOn: 1 }).toISOString();
      if (!weekBuckets.has(key)) {
        weekBuckets.set(key, []);
        bucketOrder.push({ kind: "week", key });
      }
      weekBuckets.get(key)!.push(deal);
      continue;
    }
    const key = startOfMonth(createdAt).toISOString();
    if (!monthBuckets.has(key)) {
      monthBuckets.set(key, []);
      bucketOrder.push({ kind: "month", key });
    }
    monthBuckets.get(key)!.push(deal);
  }

  for (const { kind, key } of bucketOrder) {
    if (kind === "week") {
      const bucketDeals = weekBuckets.get(key)!;
      if (bucketDeals.length < MIN_GROUP_SIZE) {
        for (const deal of bucketDeals) entries.push({ kind: "individual", deal });
        continue;
      }
      const weekStart = new Date(key);
      entries.push({
        kind: "week-group",
        key,
        weekStart,
        weekEnd: addDays(weekStart, 7),
        deals: bucketDeals,
        totalValue: sumValue(bucketDeals),
      });
    } else {
      const bucketDeals = monthBuckets.get(key)!;
      if (bucketDeals.length < MIN_GROUP_SIZE) {
        for (const deal of bucketDeals) entries.push({ kind: "individual", deal });
        continue;
      }
      entries.push({
        kind: "month-group",
        key,
        monthStart: new Date(key),
        deals: bucketDeals,
        totalValue: sumValue(bucketDeals),
      });
    }
  }

  return entries;
}

/** "1 sept – 7 sept" — locale-aware via Intl, not date-fns's format()
 *  (which always renders in English unless given an explicit locale
 *  object — the same bug already caught and fixed in lib/period.ts). */
export function formatWeekGroupLabel(entry: WeekGroupEntry): string {
  const inclusiveEnd = new Date(entry.weekEnd.getTime() - 1);
  const start = entry.weekStart.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const end = inclusiveEnd.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${start} – ${end}`;
}

/** "Agosto 2026" — same toLocaleDateString call lib/period.ts uses for
 *  its thisMonth/lastMonth labels. */
export function formatMonthGroupLabel(entry: MonthGroupEntry): string {
  return entry.monthStart.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}
