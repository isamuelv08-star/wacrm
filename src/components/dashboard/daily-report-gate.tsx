"use client"

import { useCallback, useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { isValidTimezone } from "@/lib/automations/schedule"
import { DailyReportDialog } from "./daily-report-dialog"

/** "YYYY-MM-DD" in the given IANA zone — same `Intl.DateTimeFormat`
 *  'en-CA' trick src/lib/ai/timezone.ts already uses for a local wall-
 *  clock reading, kept local here since this is the only place that
 *  needs just the date part (not the full "weekday, date, time"
 *  string that helper builds). */
function localDateKey(date: Date, timezone: string): string {
  const tz = isValidTimezone(timezone) ? timezone : "UTC"
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date)
}

/**
 * Headless (until it has something to show): decides whether this
 * login should surface the daily commercial report popup, and owns
 * the `profiles.daily_report_last_shown_at` watermark that keeps it
 * from reappearing — same per-user "last shown" column pattern
 * `team_chat_last_read_at` already established (migration 090), same
 * direct RLS-scoped `.update()` from the client, no new policy
 * needed (`profiles_update` already allows `auth.uid() = user_id` to
 * touch any column on their own row).
 *
 * Gated by the SAME `dailyInsights` dashboard permission the panel on
 * /dashboard and /dashboard/informe use (not a hardcoded role check),
 * so an explicit per-member override is respected here too. Compared
 * against "today" in the ACCOUNT's own timezone, not the browser's or
 * UTC's, so a login just after local midnight doesn't miss the day's
 * report and one just before it doesn't get shown twice.
 */
export function DailyReportGate() {
  const { user, accountId, canViewDashboardSection, loading: authLoading } = useAuth()
  const [open, setOpen] = useState(false)
  const [checkedForUserId, setCheckedForUserId] = useState<string | null>(null)

  useEffect(() => {
    if (authLoading || !user?.id || !accountId) return
    if (checkedForUserId === user.id) return // already resolved this session
    if (!canViewDashboardSection("dailyInsights")) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- role/permission check, not a data fetch; marks this user "resolved" so the effect doesn't re-run every render
      setCheckedForUserId(user.id)
      return
    }

    let cancelled = false
    const supabase = createClient()
    // AccountSummary (useAuth's own account object) doesn't carry
    // timezone — a small separate read rather than widening that
    // shared query, same posture as the profiles read below.
    Promise.all([
      supabase.from("profiles").select("daily_report_last_shown_at").eq("user_id", user.id).maybeSingle(),
      supabase.from("accounts").select("timezone").eq("id", accountId).maybeSingle(),
    ]).then(([profileRes, accountRes]) => {
      if (cancelled) return
      setCheckedForUserId(user.id)
      if (profileRes.error) {
        console.error("[daily-report] last-shown lookup failed:", profileRes.error.message)
        return
      }
      const lastShownAt = (
        profileRes.data as { daily_report_last_shown_at: string | null } | null
      )?.daily_report_last_shown_at
      const timezone = (accountRes.data as { timezone: string | null } | null)?.timezone || "UTC"
      const today = localDateKey(new Date(), timezone)
      const lastShownDay = lastShownAt ? localDateKey(new Date(lastShownAt), timezone) : null
      if (lastShownDay !== today) setOpen(true)
    })
    return () => {
      cancelled = true
    }
  }, [authLoading, user?.id, accountId, checkedForUserId, canViewDashboardSection])

  // Stamps the watermark the instant the dialog closes — "Ver informe
  // completo" and "Ahora no" both count as "seen it today" (see
  // DailyReportDialog's own doc comment for why neither reopens it).
  const markShown = useCallback(() => {
    if (!user?.id) return
    void createClient()
      .from("profiles")
      .update({ daily_report_last_shown_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .then(({ error }) => {
        if (error) console.error("[daily-report] failed to stamp last-shown:", error.message)
      })
  }, [user])

  if (!open) return null

  return (
    <DailyReportDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) markShown()
      }}
    />
  )
}
