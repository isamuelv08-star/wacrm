"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Measures this device's clock skew against the server (GET
 * /api/time) once per mount, and hands back a `now()` that corrects
 * for it. Fixes the class of bug where a time-sensitive computation
 * (today: the inbox's 24h WhatsApp session timer) disagreed between
 * two people looking at the exact same conversation, because one of
 * their devices simply had the wrong clock — `new Date()` on a phone
 * with a stale/misconfigured time doesn't know it's wrong.
 *
 * Round-trip latency is accounted for with the classic midpoint
 * estimate: the server's timestamp is assumed to correspond to the
 * midpoint between when the request left and when the response
 * arrived, not either endpoint — good enough for a minute-granularity
 * UI timer, not attempting NTP-grade precision.
 *
 * Returns 0 offset (i.e. trusts the local clock) until the very first
 * measurement resolves, so callers work immediately and just get more
 * accurate a moment later — never blocks on this.
 */
export function useServerClock() {
  const offsetMsRef = useRef(0);
  const [, forceRerender] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const t0 = Date.now();
    fetch("/api/time")
      .then((res) => res.json())
      .then((data: { now: string }) => {
        if (cancelled) return;
        const t1 = Date.now();
        const serverMs = new Date(data.now).getTime();
        if (!Number.isFinite(serverMs)) return;
        const roundTripMidpoint = t0 + (t1 - t0) / 2;
        offsetMsRef.current = serverMs - roundTripMidpoint;
        // Only re-render once, to pick up a corrected offset for
        // whatever's already mounted — callers reading `now()` after
        // this point get the corrected value without needing it.
        forceRerender((n) => n + 1);
      })
      .catch(() => {
        // Offline, or the request failed — offset stays 0 (trust the
        // local clock), same as before this hook existed.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return {
    /** Current time, corrected for this device's measured clock skew. */
    now: () => new Date(Date.now() + offsetMsRef.current),
  };
}
