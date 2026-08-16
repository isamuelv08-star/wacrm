// ============================================================
// /api/locale
//
//   POST — set the NEXT_LOCALE cookie the language selector writes to.
//          No auth/account context needed — this is a UI preference,
//          not account data, and the cookie applies per-browser like
//          the theme choice does (though that one is localStorage-only
//          since it never needs the server to know).
// ============================================================

import { NextResponse } from "next/server";
import { LOCALE_COOKIE, isSupportedLocale } from "@/lib/i18n/locales";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export async function POST(request: Request) {
  let locale: unknown;
  try {
    ({ locale } = await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof locale !== "string" || !isSupportedLocale(locale)) {
    return NextResponse.json({ error: "Unsupported locale" }, { status: 400 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: ONE_YEAR_SECONDS,
    sameSite: "lax",
  });
  return response;
}
