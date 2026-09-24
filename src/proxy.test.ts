import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// --- Scenario knobs the mock reads -----------------------------------------
// `mockUser`         — what getUser() resolves to (a refreshed session ⇒ user,
//                      or null for the logged-out path).
// `refreshedCookies` — cookies Supabase writes via setAll() during getUser(),
//                      i.e. the freshly *rotated* auth token. The whole point
//                      of the test is that these must survive onto whatever
//                      response the proxy returns — including redirects.
let mockUser: { id: string } | null = null;
// "aal1" (default) = no verified MFA factor, or step-up already done.
// "aal2" = a verified TOTP factor exists but this session hasn't
// completed it yet — exercises the /login-mfa redirect.
let mockNextAal: "aal1" | "aal2" = "aal1";
// How many times the proxy actually asked Supabase Auth to validate a session.
let getUserCalls = 0;
let refreshedCookies: Array<{
  name: string;
  value: string;
  options: Record<string, unknown>;
}> = [];

vi.mock("@supabase/ssr", () => ({
  createServerClient: (
    _url: string,
    _key: string,
    opts: {
      cookies: { setAll: (c: typeof refreshedCookies) => void };
    },
  ) => ({
    auth: {
      // Mirrors real auth-js: an expired access token is transparently
      // refreshed inside getUser(), which rotates the refresh token and
      // pushes the new cookies through setAll() before resolving.
      getUser: async () => {
        getUserCalls++;
        if (refreshedCookies.length) opts.cookies.setAll(refreshedCookies);
        return { data: { user: mockUser } };
      },
      // No enrolled MFA factors in these tests — aal1 is already the
      // "fully signed in" state, matching real GoTrue's behavior for
      // a user with zero verified factors. The step-up redirect gets
      // its own dedicated describe block below.
      mfa: {
        getAuthenticatorAssuranceLevel: async () => ({
          data: { currentLevel: "aal1", nextLevel: mockNextAal, currentAuthenticationMethods: [] },
          error: null,
        }),
      },
    },
  }),
}));

// Imported after the mock is registered.
const { proxy } = await import("./proxy");
const { clearProxyUserCache } = await import("@/lib/auth/proxy-user-cache");

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  mockUser = null;
  mockNextAal = "aal1";
  refreshedCookies = [];
  getUserCalls = 0;
  delete process.env.PROXY_AUTH_CACHE_MS;
  clearProxyUserCache();
});

afterEach(() => vi.clearAllMocks());

const ROTATED = {
  name: "sb-test-auth-token",
  value: "rotated-refresh-token",
  options: { path: "/", httpOnly: true },
};

describe("proxy — refreshed auth cookies survive redirects", () => {
  it("carries the rotated token when redirecting a signed-in user off /login", async () => {
    mockUser = { id: "user-1" };
    refreshedCookies = [ROTATED];

    const res = await proxy(
      new NextRequest("https://app.test/login"),
    );

    // Redirect to /dashboard…
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/dashboard");
    // …and the rotated cookie MUST ride along, otherwise the browser keeps
    // replaying the now-consumed refresh token and the session wedges until
    // the user manually clears cookies.
    expect(res.cookies.get(ROTATED.name)?.value).toBe(ROTATED.value);
  });

  it("carries the rotated token when redirecting an unauth user to /login", async () => {
    mockUser = null;
    // Even on the logged-out path getUser() may emit cookie writes (e.g.
    // clearing a dead session); those must not be dropped on the redirect.
    refreshedCookies = [{ ...ROTATED, value: "cleared" }];

    const res = await proxy(
      new NextRequest("https://app.test/dashboard"),
    );

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
    expect(res.cookies.get(ROTATED.name)?.value).toBe("cleared");
  });

  it("redirects a signed-in user with an invite token to /join/<token>", async () => {
    mockUser = { id: "user-1" };
    refreshedCookies = [ROTATED];

    const res = await proxy(
      new NextRequest("https://app.test/login?invite=abc123"),
    );

    expect(res.headers.get("location")).toContain("/join/abc123");
    expect(res.cookies.get(ROTATED.name)?.value).toBe(ROTATED.value);
  });

  it("passes through (no redirect) for a signed-in user on a protected page", async () => {
    mockUser = { id: "user-1" };
    refreshedCookies = [ROTATED];

    const res = await proxy(
      new NextRequest("https://app.test/dashboard"),
    );

    // No redirect — the normal NextResponse.next() already carries cookies.
    expect(res.headers.get("location")).toBeNull();
    expect(res.cookies.get(ROTATED.name)?.value).toBe(ROTATED.value);
  });
});

describe("proxy — session validation memo", () => {
  const withSession = (token: string, path = "/dashboard") =>
    new NextRequest(`https://app.test${path}`, {
      headers: { cookie: `sb-test-auth-token=${token}` },
    });

  it("validates the same session once, then serves repeats from memory", async () => {
    mockUser = { id: "user-1" };

    const first = await proxy(withSession("tok-a"));
    const second = await proxy(withSession("tok-a", "/contacts"));
    const third = await proxy(withSession("tok-a", "/api/whatsapp/numbers"));

    expect(getUserCalls).toBe(1);
    // Behaviour is identical: signed-in users are let through.
    for (const res of [first, second, third]) expect(res.headers.get("location")).toBeNull();
  });

  it("validates again when the token changes (rotation / a different user)", async () => {
    mockUser = { id: "user-1" };
    await proxy(withSession("tok-a"));
    await proxy(withSession("tok-b"));
    expect(getUserCalls).toBe(2);
  });

  it("never remembers a signed-out result, so signing in works at once", async () => {
    mockUser = null;
    const before = await proxy(withSession("tok-a"));
    expect(before.headers.get("location")).toContain("/login");

    mockUser = { id: "user-1" };
    const after = await proxy(withSession("tok-a"));
    expect(after.headers.get("location")).toBeNull();
    expect(getUserCalls).toBe(2);
  });

  it("does nothing for requests without Supabase cookies", async () => {
    mockUser = { id: "user-1" };
    await proxy(new NextRequest("https://app.test/dashboard"));
    await proxy(new NextRequest("https://app.test/dashboard"));
    expect(getUserCalls).toBe(2);
  });

  it("can be turned off with PROXY_AUTH_CACHE_MS=0", async () => {
    process.env.PROXY_AUTH_CACHE_MS = "0";
    mockUser = { id: "user-1" };
    await proxy(withSession("tok-a"));
    await proxy(withSession("tok-a"));
    expect(getUserCalls).toBe(2);
  });
});

describe("proxy — MFA step-up gate", () => {
  it("redirects a protected page to /login-mfa when a step-up is pending", async () => {
    mockUser = { id: "user-1" };
    mockNextAal = "aal2";

    const res = await proxy(new NextRequest("https://app.test/dashboard"));

    expect(res.headers.get("location")).toContain("/login-mfa");
    expect(res.headers.get("location")).toContain("next=%2Fdashboard");
  });

  it("redirects off /login to /login-mfa (not /dashboard) when a step-up is pending", async () => {
    mockUser = { id: "user-1" };
    mockNextAal = "aal2";

    const res = await proxy(new NextRequest("https://app.test/login"));

    expect(res.headers.get("location")).toContain("/login-mfa");
    expect(res.headers.get("location")).not.toContain("/dashboard");
  });

  it("lets a pending-step-up user reach /login-mfa itself", async () => {
    mockUser = { id: "user-1" };
    mockNextAal = "aal2";

    const res = await proxy(new NextRequest("https://app.test/login-mfa"));

    expect(res.headers.get("location")).toBeNull();
  });

  it("does not redirect when the session already satisfies aal2 (no factor, or already stepped up)", async () => {
    mockUser = { id: "user-1" };
    mockNextAal = "aal1";

    const res = await proxy(new NextRequest("https://app.test/dashboard"));

    expect(res.headers.get("location")).toBeNull();
  });
});
