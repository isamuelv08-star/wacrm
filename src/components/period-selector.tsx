"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isBefore,
  isSameDay,
  isSameMonth,
  isToday,
  isWithinInterval,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { rangeForPreset, formatRangeLabel, type PeriodPreset } from "@/lib/period";
import { cn } from "@/lib/utils";

// Quick-pick list, most useful/recent first — mirrors the familiar
// analytics-tool date picker (today/yesterday/last N days/weeks/…)
// rather than the old always-open segmented button row, which only
// offered calendar-month-aligned presets and no way to start "from
// today".
const QUICK_PRESETS: PeriodPreset[] = [
  "today",
  "yesterday",
  "last7Days",
  "last30Days",
  "thisWeek",
  "lastWeek",
  "thisMonth",
  "lastMonth",
  "thisQuarter",
  "thisYear",
  "allTime",
];

const PRESET_LABEL_KEY: Record<PeriodPreset, string> = {
  today: "presetToday",
  yesterday: "presetYesterday",
  last7Days: "presetLast7Days",
  last30Days: "presetLast30Days",
  thisWeek: "presetThisWeek",
  lastWeek: "presetLastWeek",
  thisMonth: "presetThisMonth",
  lastMonth: "presetLastMonth",
  thisQuarter: "presetThisQuarter",
  thisYear: "presetThisYear",
  allTime: "presetAllTime",
  custom: "presetCustom",
};

interface PeriodSelectorProps {
  preset: PeriodPreset;
  /** yyyy-mm-dd, only meaningful while preset === "custom". */
  customStart: string;
  customEnd: string;
  onPresetChange: (preset: PeriodPreset) => void;
  onCustomChange: (start: string, end: string) => void;
}

function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fromIso(s: string): Date | null {
  if (!s) return null;
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

export function PeriodSelector({
  preset,
  customStart,
  customEnd,
  onPresetChange,
  onCustomChange,
}: PeriodSelectorProps) {
  const t = useTranslations("Common.period");
  const [open, setOpen] = useState(false);

  const triggerLabel = useMemo(() => {
    if (preset === "custom" && customStart && customEnd) {
      return formatRangeLabel(
        rangeForPreset("custom", { start: new Date(customStart), end: new Date(customEnd) }),
        t,
      );
    }
    return t(PRESET_LABEL_KEY[preset]);
  }, [preset, customStart, customEnd, t]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="flex items-center gap-1.5 rounded-md border border-border bg-muted/50 px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted">
        <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
        {triggerLabel}
      </PopoverTrigger>

      <PopoverContent align="end" className="w-auto p-0">
        {/* Keying the panel to the open transition (rather than
            syncing its draft state via an effect) remounts it fresh
            each time it opens, so it always starts from the
            currently-committed preset/dates. */}
        {open && (
          <PeriodPickerPanel
            preset={preset}
            customStart={customStart}
            customEnd={customEnd}
            onApply={(p, start, end) => {
              if (p === "custom" && start && end) {
                // Custom needs both dates landed before the range means
                // anything — send them first so the parent's fetch fires
                // with the right window, then confirm the preset (a
                // no-op for it once the dates are already set).
                onCustomChange(toIso(start), toIso(end));
                onPresetChange("custom");
              } else {
                onPresetChange(p);
              }
              setOpen(false);
            }}
            onCancel={() => setOpen(false)}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

interface PeriodPickerPanelProps {
  preset: PeriodPreset;
  customStart: string;
  customEnd: string;
  onApply: (preset: PeriodPreset, start: Date | null, end: Date | null) => void;
  onCancel: () => void;
}

function PeriodPickerPanel({ preset, customStart, customEnd, onApply, onCancel }: PeriodPickerPanelProps) {
  const t = useTranslations("Common.period");
  const tCal = useTranslations("Calendar");

  const [draftPreset, setDraftPreset] = useState<PeriodPreset>(preset);
  const [draftStart, setDraftStart] = useState<Date | null>(() => fromIso(customStart));
  const [draftEnd, setDraftEnd] = useState<Date | null>(() => fromIso(customEnd));
  const [pickingEnd, setPickingEnd] = useState(false);
  const [month, setMonth] = useState(() => fromIso(customStart) ?? new Date());

  function applyQuickPreset(p: PeriodPreset) {
    const range = rangeForPreset(p);
    setDraftPreset(p);
    setDraftStart(range.start);
    setDraftEnd(new Date(range.end.getTime() - 1));
    setMonth(range.start);
    setPickingEnd(false);
  }

  function pickDay(day: Date) {
    setDraftPreset("custom");
    if (!pickingEnd || !draftStart) {
      setDraftStart(day);
      setDraftEnd(day);
      setPickingEnd(true);
      return;
    }
    if (isBefore(day, draftStart)) {
      setDraftEnd(draftStart);
      setDraftStart(day);
    } else {
      setDraftEnd(day);
    }
    setPickingEnd(false);
  }

  const gridStart = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
  const gridEnd = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });
  const weekdayLabels = [
    tCal("weekdayMon"),
    tCal("weekdayTue"),
    tCal("weekdayWed"),
    tCal("weekdayThu"),
    tCal("weekdayFri"),
    tCal("weekdaySat"),
    tCal("weekdaySun"),
  ];

  return (
    <div className="flex">
      <div className="flex w-32 shrink-0 flex-col gap-0.5 border-r border-border p-1.5">
        {QUICK_PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => applyQuickPreset(p)}
            className={cn(
              "rounded px-2 py-1.5 text-left text-xs font-medium transition-colors",
              draftPreset === p
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {t(PRESET_LABEL_KEY[p])}
          </button>
        ))}
      </div>

      <div className="flex w-52 flex-col p-2">
        <div className="mb-2 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setMonth(subMonths(month, 1))}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label={tCal("prevMonth")}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <span className="text-xs font-semibold text-foreground capitalize">
            {month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
          </span>
          <button
            type="button"
            onClick={() => setMonth(addMonths(month, 1))}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label={tCal("nextMonth")}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="grid grid-cols-7 justify-items-center gap-y-0.5">
          {weekdayLabels.map((label, i) => (
            <div
              key={`${label}-${i}`}
              className="flex h-6 w-6 items-center justify-center text-[10px] font-medium text-muted-foreground"
            >
              {label}
            </div>
          ))}

          {days.map((day) => {
            const inMonth = isSameMonth(day, month);
            const inRange =
              draftStart && draftEnd ? isWithinInterval(day, { start: draftStart, end: draftEnd }) : false;
            const isStart = draftStart ? isSameDay(day, draftStart) : false;
            const isEnd = draftEnd ? isSameDay(day, draftEnd) : false;
            const isEdge = isStart || isEnd;
            const isRangeSpan = draftStart && draftEnd ? !isSameDay(draftStart, draftEnd) : false;

            return (
              <button
                key={day.toISOString()}
                type="button"
                onClick={() => pickDay(day)}
                className={cn(
                  "flex h-6 w-6 items-center justify-center text-[11px] transition-colors",
                  !inMonth && "text-muted-foreground/30",
                  inMonth && !inRange && "text-foreground hover:bg-muted",
                  inRange && !isEdge && "bg-primary/10 text-foreground",
                  isEdge && "rounded-full bg-primary font-semibold text-primary-foreground",
                  isStart && isRangeSpan && "rounded-l-full rounded-r-none",
                  isEnd && isRangeSpan && "rounded-r-full rounded-l-none",
                  isToday(day) && !isEdge && "font-semibold text-primary",
                )}
              >
                {format(day, "d")}
              </button>
            );
          })}
        </div>

        <div className="mt-3 flex items-center justify-end gap-1.5 border-t border-border pt-2.5">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            onClick={() => onApply(draftPreset, draftStart, draftEnd)}
            disabled={draftPreset === "custom" && (!draftStart || !draftEnd)}
            className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
          >
            {t("apply")}
          </button>
        </div>
      </div>
    </div>
  );
}
