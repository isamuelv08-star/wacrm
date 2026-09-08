"use client";

import { useCallback, useEffect, useState } from "react";
import {
  DESKTOP_NOTIFICATIONS_STORAGE_KEY,
  isDesktopNotificationsSupported,
} from "@/lib/notifications/desktop";

/**
 * User-facing on/off switch for OS-level (Chrome/desktop) notifications
 * on new leads, backed by the Notification API's own permission plus an
 * explicit opt-in flag in localStorage. Powers the toggle button on the
 * Notifications page; the realtime listener that actually fires
 * notifications reads the same two sources via
 * lib/notifications/desktop.ts's `isDesktopNotificationsEnabled`.
 */
export function useDesktopNotificationsSetting() {
  const supported = isDesktopNotificationsSupported();
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (!supported) return;
    setPermission(Notification.permission);
    try {
      const optedIn =
        localStorage.getItem(DESKTOP_NOTIFICATIONS_STORAGE_KEY) === "true";
      setEnabled(optedIn && Notification.permission === "granted");
    } catch {
      // localStorage can throw in private-browsing / sandboxed contexts.
    }
  }, [supported]);

  const enable = useCallback(async () => {
    if (!supported) return false;
    const result = await Notification.requestPermission();
    setPermission(result);
    const granted = result === "granted";
    setEnabled(granted);
    try {
      localStorage.setItem(DESKTOP_NOTIFICATIONS_STORAGE_KEY, String(granted));
    } catch {
      // Persistence is best-effort; ignore storage failures.
    }
    return granted;
  }, [supported]);

  const disable = useCallback(() => {
    setEnabled(false);
    try {
      localStorage.setItem(DESKTOP_NOTIFICATIONS_STORAGE_KEY, "false");
    } catch {
      // Persistence is best-effort; ignore storage failures.
    }
  }, []);

  return { supported, permission, enabled, enable, disable };
}
