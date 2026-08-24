"use client";

import { useTranslations } from "next-intl";
import type { PeriodPreset } from "@/lib/period";
import { cn } from "@/lib/utils";

const PRESETS: PeriodPreset[] = ["thisMonth", "lastMonth", "thisQuarter", "thisYear", "allTime"];

interface PeriodSelectorProps {
  preset: PeriodPreset;
  /** yyyy-mm-dd, only meaningful while preset === "custom". */
  customStart: string;
  customEnd: string;
  onPresetChange: (preset: PeriodPreset) => void;
  onCustomChange: (start: string, end: string) => void;
}

const PRESET_LABEL_KEY: Record<PeriodPreset, string> = {
  thisMonth: "presetThisMonth",
  lastMonth: "presetLastMonth",
  thisQuarter: "presetThisQuarter",
  thisYear: "presetThisYear",
  allTime: "presetAllTime",
  custom: "presetCustom",
};

export function PeriodSelector({
  preset,
  customStart,
  customEnd,
  onPresetChange,
  onCustomChange,
}: PeriodSelectorProps) {
  const t = useTranslations("Common.period");

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap rounded-md border border-border p-0.5">
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onPresetChange(p)}
            className={cn(
              "rounded px-2 py-0.5 text-xs font-medium transition-colors",
              preset === p
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t(PRESET_LABEL_KEY[p])}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onPresetChange("custom")}
          className={cn(
            "rounded px-2 py-0.5 text-xs font-medium transition-colors",
            preset === "custom"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {t(PRESET_LABEL_KEY.custom)}
        </button>
      </div>

      {preset === "custom" && (
        <div className="flex items-center gap-1.5 text-xs">
          <label className="flex items-center gap-1 text-muted-foreground">
            {t("from")}
            <input
              type="date"
              value={customStart}
              max={customEnd || undefined}
              onChange={(e) => onCustomChange(e.target.value, customEnd)}
              className="h-7 rounded-md border border-border bg-muted px-1.5 text-foreground outline-none focus:border-primary"
            />
          </label>
          <label className="flex items-center gap-1 text-muted-foreground">
            {t("to")}
            <input
              type="date"
              value={customEnd}
              min={customStart || undefined}
              onChange={(e) => onCustomChange(customStart, e.target.value)}
              className="h-7 rounded-md border border-border bg-muted px-1.5 text-foreground outline-none focus:border-primary"
            />
          </label>
        </div>
      )}
    </div>
  );
}
