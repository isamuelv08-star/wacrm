"use client";

import { useEffect, useState } from "react";
import { useLocale } from "next-intl";

/**
 * Live date + time readout for the header's left cluster (matches the
 * "Today, Mon 22 Nov" reference design, extended with the clock the
 * user asked for). Ticks once a minute — seconds aren't shown, so a
 * faster interval would just burn renders for no visible change.
 */
export function LiveClock() {
  const locale = useLocale();
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- first tick happens immediately, then every minute
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Server-rendered markup has no "now" yet (avoids a hydration
  // mismatch from the server's clock vs. the browser's) — the real
  // value fills in a moment after mount.
  if (!now) return <span className="hidden text-xs text-muted-foreground sm:inline" />;

  const date = now.toLocaleDateString(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  const time = now.toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <span className="hidden truncate text-xs text-muted-foreground sm:inline">
      {date} · {time}
    </span>
  );
}
