import { NextResponse } from "next/server";

/**
 * GET /api/time
 *
 * Trivial, public, no-store — just the server's own clock. Exists so
 * client components computing something time-sensitive (today: the
 * inbox's 24h WhatsApp session-window timer) can measure against the
 * SERVER's clock instead of trusting `new Date()` on whatever device
 * happens to be open. Two agents on the same conversation, one with a
 * misconfigured device clock, used to disagree on whether the 24h
 * window was still open — same messages, same real deadline, but a
 * different verdict depending on whose phone had the wrong time.
 *
 * No auth/account context needed: this leaks nothing about any
 * account, and it needs to work for a signed-in agent regardless of
 * which account/role they're in.
 */
export async function GET() {
  return NextResponse.json({ now: new Date().toISOString() });
}
