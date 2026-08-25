import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DOW_SHORT_MON_FIRST,
  daysAgoStart,
  lastNDayKeys,
  lastNMonthKeys,
  localDayKey,
  mondayIndex,
  monthKey,
  monthsAgoStart,
  startOfLocalDay,
} from "./date-utils";

describe("startOfLocalDay", () => {
  it("zeroes out the time of a given date", () => {
    const d = new Date("2026-05-18T13:45:22.500");
    const out = startOfLocalDay(d);
    expect(out.getHours()).toBe(0);
    expect(out.getMinutes()).toBe(0);
    expect(out.getSeconds()).toBe(0);
    expect(out.getMilliseconds()).toBe(0);
    expect(out.getFullYear()).toBe(d.getFullYear());
    expect(out.getMonth()).toBe(d.getMonth());
    expect(out.getDate()).toBe(d.getDate());
  });

  it("does not mutate the input", () => {
    const d = new Date("2026-05-18T13:45:22.500");
    const before = d.getTime();
    startOfLocalDay(d);
    expect(d.getTime()).toBe(before);
  });
});

describe("daysAgoStart", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-18T13:45:22"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns midnight N days before today", () => {
    const out = daysAgoStart(3);
    expect(out.getHours()).toBe(0);
    expect(out.getDate()).toBe(15);
    expect(out.getMonth()).toBe(4); // May
    expect(out.getFullYear()).toBe(2026);
  });

  it("daysAgoStart(0) is today at midnight", () => {
    const out = daysAgoStart(0);
    expect(out.getDate()).toBe(18);
    expect(out.getHours()).toBe(0);
  });

  it("crosses month boundaries cleanly", () => {
    vi.setSystemTime(new Date("2026-05-02T08:00:00"));
    const out = daysAgoStart(5);
    expect(out.getMonth()).toBe(3); // April (0-indexed)
    expect(out.getDate()).toBe(27);
  });
});

describe("localDayKey", () => {
  it("emits YYYY-MM-DD in local components", () => {
    const d = new Date(2026, 0, 9, 23, 59); // Jan 9, locally
    expect(localDayKey(d)).toBe("2026-01-09");
  });

  it("zero-pads month and day", () => {
    const d = new Date(2026, 8, 5); // Sep 5
    expect(localDayKey(d)).toBe("2026-09-05");
  });

  it("accepts ISO strings as input", () => {
    expect(localDayKey("2026-12-31T23:00:00")).toBe("2026-12-31");
  });
});

describe("lastNDayKeys", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-18T08:30:00"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns n consecutive chronological keys ending today", () => {
    expect(lastNDayKeys(3)).toEqual(["2026-05-16", "2026-05-17", "2026-05-18"]);
  });

  it("returns just today for n=1", () => {
    expect(lastNDayKeys(1)).toEqual(["2026-05-18"]);
  });

  it("rolls back across a month boundary", () => {
    vi.setSystemTime(new Date("2026-05-02T08:00:00"));
    expect(lastNDayKeys(4)).toEqual([
      "2026-04-29",
      "2026-04-30",
      "2026-05-01",
      "2026-05-02",
    ]);
  });
});

describe("mondayIndex", () => {
  it("maps Monday → 0 and Sunday → 6", () => {
    // Date-only ISO strings ("2026-05-18") parse as UTC midnight, not
    // local midnight — on a machine whose local timezone is behind
    // UTC that rolls back to the previous calendar day, making the
    // assertion depend on the timezone the tests happen to run in.
    // The explicit "T00:00:00" (no "Z") always parses as local time.
    expect(mondayIndex(new Date("2026-05-18T00:00:00"))).toBe(0); // Mon
    expect(mondayIndex(new Date("2026-05-19T00:00:00"))).toBe(1); // Tue
    expect(mondayIndex(new Date("2026-05-23T00:00:00"))).toBe(5); // Sat
    expect(mondayIndex(new Date("2026-05-24T00:00:00"))).toBe(6); // Sun
  });

  it("aligns with DOW_SHORT_MON_FIRST labels", () => {
    expect(DOW_SHORT_MON_FIRST[mondayIndex(new Date("2026-05-18T00:00:00"))]).toBe(
      "Mon",
    );
    expect(DOW_SHORT_MON_FIRST[mondayIndex(new Date("2026-05-24T00:00:00"))]).toBe(
      "Sun",
    );
  });
});

describe("monthKey", () => {
  it("emits YYYY-MM-01 regardless of the day of month", () => {
    expect(monthKey(new Date(2026, 4, 18))).toBe("2026-05-01"); // May
    expect(monthKey(new Date(2026, 4, 1))).toBe("2026-05-01");
    expect(monthKey(new Date(2026, 4, 31))).toBe("2026-05-01");
  });

  it("zero-pads single-digit months", () => {
    expect(monthKey(new Date(2026, 0, 15))).toBe("2026-01-01"); // Jan
  });

  it("accepts ISO strings as input", () => {
    expect(monthKey("2026-05-18T23:00:00")).toBe("2026-05-01");
  });
});

describe("monthsAgoStart", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 18, 13, 45)); // May 18, mid-month
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("monthsAgoStart(0) is the first of the current month at midnight", () => {
    const out = monthsAgoStart(0);
    expect(out.getFullYear()).toBe(2026);
    expect(out.getMonth()).toBe(4); // May
    expect(out.getDate()).toBe(1);
    expect(out.getHours()).toBe(0);
  });

  it("rolls back N months, clamped to the 1st so short months can't skid forward", () => {
    const out = monthsAgoStart(2);
    expect(out.getMonth()).toBe(2); // March
    expect(out.getDate()).toBe(1);
  });

  it("crosses a year boundary cleanly", () => {
    const out = monthsAgoStart(6);
    expect(out.getFullYear()).toBe(2025);
    expect(out.getMonth()).toBe(10); // November
    expect(out.getDate()).toBe(1);
  });
});

describe("lastNMonthKeys", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 18)); // May 18
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns n consecutive chronological month keys ending this month", () => {
    expect(lastNMonthKeys(3)).toEqual(["2026-03-01", "2026-04-01", "2026-05-01"]);
  });

  it("returns just this month for n=1", () => {
    expect(lastNMonthKeys(1)).toEqual(["2026-05-01"]);
  });

  it("rolls back across a year boundary", () => {
    vi.setSystemTime(new Date(2026, 1, 1)); // Feb 1
    expect(lastNMonthKeys(4)).toEqual([
      "2025-11-01",
      "2025-12-01",
      "2026-01-01",
      "2026-02-01",
    ]);
  });
});
