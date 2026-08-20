/**
 * Due-check logic for `time_based` automations.
 *
 * v1 supports one schedule shape: a daily "HH:mm" (24h) time-of-day,
 * optionally paired with an IANA timezone (defaults to UTC). Full cron
 * expressions are NOT supported yet — there's no cron-parsing
 * dependency in this project, and hand-rolling one has too much edge-
 * case surface to trust for something that silently no-ops on a
 * mistake. `validateTriggerForActivation` rejects anything that isn't
 * a valid HH:mm string, specifically so an unsupported schedule can't
 * activate cleanly and then just never fire (the bug this module
 * exists to close).
 */

export interface TimeOfDay {
  hour: number;
  minute: number;
}

const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Parses a strict 24h "HH:mm" string; null for anything else (including
 *  cron expressions — see the module doc comment on why those aren't
 *  supported yet). */
export function parseTimeOfDay(schedule: string): TimeOfDay | null {
  const match = HHMM_RE.exec(schedule.trim());
  if (!match) return null;
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

export function isValidSchedule(schedule: string | undefined | null): boolean {
  return !!schedule && parseTimeOfDay(schedule) !== null;
}

/** `Intl` throws on an unrecognized IANA zone name — the cheapest
 *  correct validity check without a timezone-data dependency. */
export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function zonedParts(date: Date, timezone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  // `hour12: false` renders midnight as "24" in some engines' Intl
  // implementation rather than "00" — normalize so minutes-since-
  // midnight math below stays correct.
  const hour = get("hour") % 24;
  return { year: get("year"), month: get("month"), day: get("day"), hour, minute: get("minute") };
}

/**
 * Is this time_based automation due to fire right now?
 *
 * Fires once per calendar day (in the automation's own timezone), at
 * or after the scheduled time — not at a precise instant, since the
 * cron poll interval is coarser than a minute. `lastExecutedAt` is the
 * automation's own `last_executed_at` column (already bumped by
 * `increment_automation_execution_count` after every run, time_based
 * or not), reused here as the idempotency marker so this needed no
 * schema change: same calendar day in-zone as `now` means "already
 * fired today, skip".
 */
export function isTimeBasedAutomationDue(
  schedule: string,
  timezone: string | undefined | null,
  lastExecutedAt: string | null | undefined,
  now: Date = new Date(),
): boolean {
  const time = parseTimeOfDay(schedule);
  if (!time) return false;

  const tz = timezone && isValidTimezone(timezone) ? timezone : "UTC";
  const nowParts = zonedParts(now, tz);
  const nowMinutes = nowParts.hour * 60 + nowParts.minute;
  const scheduledMinutes = time.hour * 60 + time.minute;
  if (nowMinutes < scheduledMinutes) return false;

  if (lastExecutedAt) {
    const lastParts = zonedParts(new Date(lastExecutedAt), tz);
    const sameDay =
      lastParts.year === nowParts.year &&
      lastParts.month === nowParts.month &&
      lastParts.day === nowParts.day;
    if (sameDay) return false;
  }

  return true;
}
