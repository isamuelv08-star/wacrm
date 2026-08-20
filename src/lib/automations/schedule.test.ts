import { describe, it, expect } from "vitest";
import {
  parseTimeOfDay,
  isValidSchedule,
  isValidTimezone,
  isTimeBasedAutomationDue,
} from "./schedule";

describe("parseTimeOfDay", () => {
  it("parses valid HH:mm strings", () => {
    expect(parseTimeOfDay("09:00")).toEqual({ hour: 9, minute: 0 });
    expect(parseTimeOfDay("23:59")).toEqual({ hour: 23, minute: 59 });
    expect(parseTimeOfDay("00:00")).toEqual({ hour: 0, minute: 0 });
    expect(parseTimeOfDay("  14:30  ")).toEqual({ hour: 14, minute: 30 });
  });

  it("rejects anything else, including cron expressions", () => {
    expect(parseTimeOfDay("0 9 * * *")).toBeNull();
    expect(parseTimeOfDay("24:00")).toBeNull();
    expect(parseTimeOfDay("9:00")).toBeNull(); // must be zero-padded
    expect(parseTimeOfDay("09:60")).toBeNull();
    expect(parseTimeOfDay("")).toBeNull();
    expect(parseTimeOfDay("garbage")).toBeNull();
  });
});

describe("isValidSchedule", () => {
  it("mirrors parseTimeOfDay's acceptance", () => {
    expect(isValidSchedule("09:00")).toBe(true);
    expect(isValidSchedule("0 9 * * *")).toBe(false);
    expect(isValidSchedule(undefined)).toBe(false);
    expect(isValidSchedule(null)).toBe(false);
    expect(isValidSchedule("")).toBe(false);
  });
});

describe("isValidTimezone", () => {
  it("accepts recognized IANA zones", () => {
    expect(isValidTimezone("UTC")).toBe(true);
    expect(isValidTimezone("America/Guayaquil")).toBe(true);
    expect(isValidTimezone("Asia/Seoul")).toBe(true);
  });

  it("rejects garbage", () => {
    expect(isValidTimezone("Not/A_Real_Zone")).toBe(false);
    expect(isValidTimezone("")).toBe(false);
  });
});

describe("isTimeBasedAutomationDue", () => {
  it("is not due before the scheduled time (same day, UTC)", () => {
    const now = new Date("2026-01-15T08:59:00Z");
    expect(isTimeBasedAutomationDue("09:00", "UTC", null, now)).toBe(false);
  });

  it("is due at/after the scheduled time when it never ran before", () => {
    const now = new Date("2026-01-15T09:00:00Z");
    expect(isTimeBasedAutomationDue("09:00", "UTC", null, now)).toBe(true);
    const later = new Date("2026-01-15T09:45:00Z");
    expect(isTimeBasedAutomationDue("09:00", "UTC", null, later)).toBe(true);
  });

  it("does not re-fire the same calendar day it already ran", () => {
    const lastExecutedAt = "2026-01-15T09:03:00Z"; // fired a bit after 9am
    const laterSameDay = new Date("2026-01-15T14:00:00Z");
    expect(
      isTimeBasedAutomationDue("09:00", "UTC", lastExecutedAt, laterSameDay),
    ).toBe(false);
  });

  it("fires again the next day, past the scheduled time", () => {
    const lastExecutedAt = "2026-01-15T09:03:00Z";
    const nextDay = new Date("2026-01-16T09:05:00Z");
    expect(
      isTimeBasedAutomationDue("09:00", "UTC", lastExecutedAt, nextDay),
    ).toBe(true);
  });

  it("evaluates the schedule in the automation's own timezone, not UTC", () => {
    // 09:00 America/Guayaquil (UTC-5) is 14:00 UTC.
    const beforeInZone = new Date("2026-01-15T13:59:00Z");
    expect(
      isTimeBasedAutomationDue("09:00", "America/Guayaquil", null, beforeInZone),
    ).toBe(false);
    const atInZone = new Date("2026-01-15T14:00:00Z");
    expect(
      isTimeBasedAutomationDue("09:00", "America/Guayaquil", null, atInZone),
    ).toBe(true);
  });

  it("falls back to UTC for a missing or invalid timezone", () => {
    const now = new Date("2026-01-15T09:00:00Z");
    expect(isTimeBasedAutomationDue("09:00", null, null, now)).toBe(true);
    expect(isTimeBasedAutomationDue("09:00", "Not/A_Real_Zone", null, now)).toBe(true);
  });

  it("returns false for an unparseable schedule instead of throwing", () => {
    const now = new Date("2026-01-15T09:00:00Z");
    expect(isTimeBasedAutomationDue("0 9 * * *", "UTC", null, now)).toBe(false);
  });
});
