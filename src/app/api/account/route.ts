// ============================================================
// /api/account
//
//   GET   — current caller's account + role. Any member.
//   PATCH — rename the account and/or update the HOT-lead alert
//           threshold (hot_lead_alert_minutes, migration 040).
//                                                 Admin+.
//
// Why both verbs share a route file
//   They speak about the same singular resource (the caller's
//   account) and reuse the same `requireRole` plumbing. Splitting
//   them across files would duplicate the `account_id` lookup
//   without buying anything.
// ============================================================

import { NextResponse } from "next/server";

import {
  requireRole,
  getCurrentAccount,
  toErrorResponse,
} from "@/lib/auth/account";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    return NextResponse.json({
      account: ctx.account,
      role: ctx.role,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

const MAX_NAME_LEN = 80;
// Generous ceiling — a week. Anything longer than a business day
// defeats the point of a response-time alert, but the DB only
// enforces >= 0, so this stays a soft API-level sanity bound.
const MAX_HOT_LEAD_ALERT_MINUTES = 10_080;

export async function PATCH(request: Request) {
  try {
    const ctx = await requireRole("admin");

    // Per-user limit on admin-class mutations. Bounds accidental
    // abuse (script run in a loop) and a compromised admin session
    // spamming renames. Each admin endpoint keys its own bucket so
    // one route doesn't starve another.
    const limit = checkRateLimit(
      `admin:rename:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as {
      name?: unknown;
      hot_lead_alert_minutes?: unknown;
    } | null;

    const update: Record<string, unknown> = {};

    if (body && "name" in body) {
      const rawName = body.name;
      if (typeof rawName !== "string") {
        return NextResponse.json(
          { error: "'name' must be a string" },
          { status: 400 },
        );
      }
      const name = rawName.trim();
      if (name.length === 0) {
        return NextResponse.json(
          { error: "Account name cannot be empty" },
          { status: 400 },
        );
      }
      if (name.length > MAX_NAME_LEN) {
        return NextResponse.json(
          { error: `Account name must be ${MAX_NAME_LEN} characters or fewer` },
          { status: 400 },
        );
      }
      update.name = name;
    }

    if (body && "hot_lead_alert_minutes" in body) {
      const raw = body.hot_lead_alert_minutes;
      if (
        typeof raw !== "number" ||
        !Number.isInteger(raw) ||
        raw < 0 ||
        raw > MAX_HOT_LEAD_ALERT_MINUTES
      ) {
        return NextResponse.json(
          {
            error: `'hot_lead_alert_minutes' must be an integer between 0 and ${MAX_HOT_LEAD_ALERT_MINUTES}`,
          },
          { status: 400 },
        );
      }
      update.hot_lead_alert_minutes = raw;
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json(
        { error: "Nothing to update" },
        { status: 400 },
      );
    }

    // RLS allows this UPDATE because accounts_update requires
    // `is_account_member(id, 'admin')`, and requireRole already
    // guaranteed the caller is admin+.
    const { data, error } = await ctx.supabase
      .from("accounts")
      .update(update)
      .eq("id", ctx.accountId)
      .select("id, name, hot_lead_alert_minutes")
      .single();

    if (error) {
      console.error("[PATCH /api/account] update error:", error);
      return NextResponse.json(
        { error: "Failed to update account" },
        { status: 500 },
      );
    }

    return NextResponse.json({ account: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}
