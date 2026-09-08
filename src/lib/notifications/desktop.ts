// ============================================================
// OS-level (Chrome/desktop) notification support for new leads —
// separate from the in-app toast (new-notification-toast-listener.tsx),
// which already covers every notification type while the app has
// focus. This is for the "I stepped away from the tab" case, mirroring
// how Kommo pops a native browser notification the moment a new lead
// comes in.
//
// Two gates before anything fires: the browser's own Notification
// permission (denied/granted by the OS-level prompt) AND an explicit
// opt-in flag in localStorage — a user who granted permission once
// might still want to switch the feature off without revoking the
// browser-level grant. The toggle UI lives on the Notifications page
// (use-desktop-notifications.ts is the read/write hook for it); this
// module is the plain read side the realtime listener calls.
// ============================================================

export const DESKTOP_NOTIFICATIONS_STORAGE_KEY =
  "saleslid:desktop-notifications-enabled";

export function isDesktopNotificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function isDesktopNotificationsEnabled(): boolean {
  if (!isDesktopNotificationsSupported()) return false;
  if (Notification.permission !== "granted") return false;
  try {
    return localStorage.getItem(DESKTOP_NOTIFICATIONS_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

/**
 * Fires a native OS notification when the setting is enabled; a no-op
 * otherwise. Returns the Notification instance (so callers can wire a
 * click handler) or undefined when nothing was shown/supported.
 */
export function showDesktopNotification(
  title: string,
  options?: NotificationOptions,
): Notification | undefined {
  if (!isDesktopNotificationsEnabled()) return undefined;
  try {
    return new Notification(title, { icon: "/logo-mark.png", ...options });
  } catch {
    // Some browsers/sandboxed contexts throw synchronously even when
    // permission reads as "granted" — best-effort, never worth surfacing.
    return undefined;
  }
}
