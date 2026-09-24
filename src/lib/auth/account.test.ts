import { afterEach, describe, expect, it, vi } from "vitest";

// getCurrentAccount resolves the caller's account context. The
// regression this file guards (issue #294): account loading must NOT
// depend on a PostgREST embedded FK join (`accounts!inner`), because a
// stale schema cache makes that embed fail hard and blanks the whole
// context. It must instead read the profile and then the account with
// two plain point queries.

// ------------------------------------------------------------
// Chainable Supabase query-builder mock. Each `.from(table)` hands back
// a thenable builder pre-loaded with the result queued for that table,
// so we can assert which tables were queried and with what filters.
// ------------------------------------------------------------
interface BuilderCall {
  table: string;
  columns?: string;
  eqArgs: [string, unknown][];
}

function makeClient(opts: {
  user: { id: string } | null;
  userErr?: unknown;
  byTable: Record<string, { data: unknown; error: unknown }>;
}) {
  const calls: BuilderCall[] = [];

  const from = (table: string) => {
    const call: BuilderCall = { table, eqArgs: [] };
    calls.push(call);
    const builder = {
      select(columns: string) {
        call.columns = columns;
        return builder;
      },
      eq(col: string, val: unknown) {
        call.eqArgs.push([col, val]);
        return builder;
      },
      maybeSingle() {
        return Promise.resolve(
          opts.byTable[table] ?? { data: null, error: null },
        );
      },
    };
    return builder;
  };

  return {
    calls,
    client: {
      auth: {
        getUser: () =>
          Promise.resolve({
            data: { user: opts.user },
            error: opts.userErr ?? null,
          }),
        // No enrolled MFA factors in these tests — aal1 is already the
        // "fully signed in" state, matching real GoTrue's behavior for
        // a user with zero verified factors.
        mfa: {
          getAuthenticatorAssuranceLevel: () =>
            Promise.resolve({
              data: { currentLevel: "aal1", nextLevel: "aal1", currentAuthenticationMethods: [] },
              error: null,
            }),
        },
      },
      from,
    },
  };
}

const createClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClient(),
}));

const { getCurrentAccount, UnauthorizedError, ForbiddenError } = await import(
  "./account"
);

afterEach(() => {
  vi.clearAllMocks();
});

describe("getCurrentAccount", () => {
  it("resolves context via a plain accounts lookup, not an embedded join", async () => {
    const { client, calls } = makeClient({
      user: { id: "user-1" },
      byTable: {
        profiles: {
          data: { account_id: "acct-1", account_role: "owner" },
          error: null,
        },
        accounts: {
          data: { id: "acct-1", name: "Acme", hot_lead_alert_minutes: 15 },
          error: null,
        },
      },
    });
    createClient.mockReturnValue(client);

    const ctx = await getCurrentAccount();

    expect(ctx).toMatchObject({
      userId: "user-1",
      accountId: "acct-1",
      role: "owner",
      account: { id: "acct-1", name: "Acme", hot_lead_alert_minutes: 15 },
    });

    // Two queries: profiles by user_id, then accounts by id. Neither
    // selects an embedded relationship — the regression guard.
    expect(calls.map((c) => c.table)).toEqual(["profiles", "accounts"]);
    expect(calls[0].columns).not.toMatch(/accounts!/);
    expect(calls[0].eqArgs).toEqual([["user_id", "user-1"]]);
    expect(calls[1].columns).not.toMatch(/accounts!/);
    expect(calls[1].eqArgs).toEqual([["id", "acct-1"]]);
  });

  it("throws UnauthorizedError when there is no session", async () => {
    const { client } = makeClient({ user: null, byTable: {} });
    createClient.mockReturnValue(client);
    await expect(getCurrentAccount()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("maps a profiles query error to 'Could not load account context'", async () => {
    const { client } = makeClient({
      user: { id: "user-1" },
      byTable: {
        profiles: { data: null, error: { code: "PGRST200" } },
      },
    });
    createClient.mockReturnValue(client);
    await expect(getCurrentAccount()).rejects.toThrow(
      "Could not load account context",
    );
  });

  it("maps an accounts query error to 'Could not load account context'", async () => {
    // The exact #294 shape if the embed were still in play, but now on
    // the decoupled accounts lookup: profile resolves, account read errors.
    const { client } = makeClient({
      user: { id: "user-1" },
      byTable: {
        profiles: {
          data: { account_id: "acct-1", account_role: "admin" },
          error: null,
        },
        accounts: { data: null, error: { code: "PGRST200" } },
      },
    });
    createClient.mockReturnValue(client);
    const err = await getCurrentAccount().catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenError);
    expect(err.message).toBe("Could not load account context");
  });

  it("rejects a profile not linked to an account", async () => {
    const { client } = makeClient({
      user: { id: "user-1" },
      byTable: {
        profiles: { data: { account_id: null, account_role: null }, error: null },
      },
    });
    createClient.mockReturnValue(client);
    await expect(getCurrentAccount()).rejects.toThrow(
      "Profile is not linked to an account",
    );
  });

  it("rejects an account_id that resolves to no readable account", async () => {
    const { client } = makeClient({
      user: { id: "user-1" },
      byTable: {
        profiles: {
          data: { account_id: "acct-1", account_role: "viewer" },
          error: null,
        },
        accounts: { data: null, error: null },
      },
    });
    createClient.mockReturnValue(client);
    await expect(getCurrentAccount()).rejects.toThrow(
      "Profile is not linked to an account",
    );
  });

  // Migration 089 security fix: a 'pending' (self-signed-up, not yet
  // approved by the agency owner) or 'suspended' account must not be
  // able to reach ANY route that goes through getCurrentAccount() —
  // DashboardShell's redirect to /acceso-restringido is client-side
  // UX only, not access control, so this is the real enforcement
  // point. See migration 088_restricted_access.sql / 089's own header.
  it.each(["pending", "suspended"] as const)(
    "rejects a %s account with ForbiddenError",
    async (status) => {
      const { client } = makeClient({
        user: { id: "user-1" },
        byTable: {
          profiles: {
            data: { account_id: "acct-1", account_role: "owner" },
            error: null,
          },
          accounts: {
            data: { id: "acct-1", name: "Acme", status },
            error: null,
          },
        },
      });
      createClient.mockReturnValue(client);
      const err = await getCurrentAccount().catch((e) => e);
      expect(err).toBeInstanceOf(ForbiddenError);
      expect(err.message).toBe("Account access is restricted");
    },
  );

  it("treats a missing status column as active (backward compat, matches the DB column's own DEFAULT)", async () => {
    const { client } = makeClient({
      user: { id: "user-1" },
      byTable: {
        profiles: {
          data: { account_id: "acct-1", account_role: "owner" },
          error: null,
        },
        // No `status` field at all — the shape every other test in
        // this file already uses.
        accounts: { data: { id: "acct-1", name: "Acme" }, error: null },
      },
    });
    createClient.mockReturnValue(client);
    const ctx = await getCurrentAccount();
    expect(ctx.account.status).toBe("active");
  });
});
