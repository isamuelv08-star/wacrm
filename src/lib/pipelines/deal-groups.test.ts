import { describe, expect, it } from "vitest";
import {
  MIN_GROUP_SIZE,
  formatMonthGroupLabel,
  formatWeekGroupLabel,
  groupDealsByDate,
  type WeekGroupEntry,
  type MonthGroupEntry,
} from "./deal-groups";
import type { Deal } from "@/types";

// Fixed "now" so bucketing is deterministic regardless of when the
// test runs: a Wednesday well into September 2026.
const NOW = new Date(2026, 8, 16); // Wed Sep 16 2026

function deal(id: string, createdAt: Date, value = 100): Deal {
  return {
    id,
    user_id: "u1",
    pipeline_id: "p1",
    stage_id: "s1",
    contact_id: null,
    title: id,
    value,
    created_at: createdAt.toISOString(),
  } as Deal;
}

describe("groupDealsByDate", () => {
  it("keeps every deal from this week individual, regardless of count", () => {
    const deals = [
      deal("a", new Date(2026, 8, 16)), // today
      deal("b", new Date(2026, 8, 15)),
      deal("c", new Date(2026, 8, 14)), // Monday, start of this week
    ];
    const groups = groupDealsByDate(deals, NOW);
    expect(groups).toHaveLength(3);
    expect(groups.every((g) => g.kind === "individual")).toBe(true);
  });

  it("groups an earlier week (same month) once it has at least MIN_GROUP_SIZE deals", () => {
    const deals = [
      deal("a", new Date(2026, 8, 16)), // this week
      deal("b", new Date(2026, 8, 8)), // earlier week, same month
      deal("c", new Date(2026, 8, 9)), // earlier week, same month
    ];
    const groups = groupDealsByDate(deals, NOW);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ kind: "individual" });
    expect(groups[1].kind).toBe("week-group");
    expect((groups[1] as WeekGroupEntry).deals).toHaveLength(2);
  });

  it("does not bundle a lone deal in an earlier week into a group of one", () => {
    const deals = [deal("a", new Date(2026, 8, 16)), deal("b", new Date(2026, 8, 8))];
    const groups = groupDealsByDate(deals, NOW);
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.kind === "individual")).toBe(true);
    expect(MIN_GROUP_SIZE).toBe(2);
  });

  it("groups a fully past month into a single bucket regardless of internal week boundaries", () => {
    const deals = [
      deal("a", new Date(2026, 7, 3)), // August, week 1
      deal("b", new Date(2026, 7, 17)), // August, week 3
      deal("c", new Date(2026, 7, 28)), // August, week 5
    ];
    const groups = groupDealsByDate(deals, NOW);
    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe("month-group");
    expect((groups[0] as MonthGroupEntry).deals).toHaveLength(3);
  });

  it("orders individuals, week-groups, and month-groups most-recent-first", () => {
    const deals = [
      deal("aug-1", new Date(2026, 7, 3)),
      deal("aug-2", new Date(2026, 7, 10)),
      deal("this-week", new Date(2026, 8, 16)),
      deal("sep-w1-a", new Date(2026, 8, 1)),
      deal("sep-w1-b", new Date(2026, 8, 2)),
    ];
    const groups = groupDealsByDate(deals, NOW);
    expect(groups.map((g) => g.kind)).toEqual(["individual", "week-group", "month-group"]);
  });

  it("sums totalValue correctly per group", () => {
    const deals = [
      deal("a", new Date(2026, 7, 3), 100),
      deal("b", new Date(2026, 7, 10), 250),
    ];
    const groups = groupDealsByDate(deals, NOW);
    expect((groups[0] as MonthGroupEntry).totalValue).toBe(350);
  });
});

describe("formatWeekGroupLabel / formatMonthGroupLabel", () => {
  it("formats a week range and a month label", () => {
    const deals = [deal("a", new Date(2026, 8, 16)), deal("b", new Date(2026, 8, 8)), deal("c", new Date(2026, 8, 9))];
    const groups = groupDealsByDate(deals, NOW);
    const week = groups[1] as WeekGroupEntry;
    expect(formatWeekGroupLabel(week)).toMatch(/–/);

    const monthDeals = [deal("x", new Date(2026, 7, 3)), deal("y", new Date(2026, 7, 10))];
    const monthGroups = groupDealsByDate(monthDeals, NOW);
    const month = monthGroups[0] as MonthGroupEntry;
    expect(formatMonthGroupLabel(month)).toContain("2026");
  });
});
