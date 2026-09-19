"use client";

import { useCallback, useState } from "react";
import {
  isNotificationSoundEnabled,
  playNotificationSound,
  setNotificationSoundEnabled,
} from "@/lib/notifications/sound";

/**
 * On/off switch for the notification chime, backed by localStorage (see
 * lib/notifications/sound.ts). Turning it ON plays the chime once — the
 * click doubles as the user gesture that unlocks browser audio, and as
 * a "this is what it sounds like" preview.
 *
 * Read in the initializer rather than an effect: the only consumer is
 * the Notifications page, which mounts after the client-side auth gate,
 * so there is no server render to mismatch.
 */
export function useNotificationSoundSetting() {
  const [enabled, setEnabled] = useState<boolean>(() =>
    typeof window === "undefined" ? true : isNotificationSoundEnabled(),
  );

  const toggle = useCallback(() => {
    const next = !enabled;
    setNotificationSoundEnabled(next);
    setEnabled(next);
    if (next) playNotificationSound();
  }, [enabled]);

  return { enabled, toggle };
}
