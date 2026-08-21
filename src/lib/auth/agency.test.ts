import { afterEach, describe, expect, it, vi } from "vitest";

// requireSuperAdmin gates the ONE place in the app that intentionally
// bypasses per-account RLS (the agency owner's cross-account panel).
// These tests are the only thing testable without a real session/DB
// in this environment — see the plan's verification note for what
// still needs a human to confirm live (a non-super-admin actually
// hitting /agency and getting a 404).

function makeClient(opts: { user: { id: string } | null; userErr?: unknown }) {
  return {
    auth: {
      getUser: () =>
        Promise.resolve({
          data: { user: opts.user },
          error: opts.userErr ?? null,
        }),
    },
  };
}

const createClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClient(),
}));

const { requireSuperAdmin } = await import("./agency");
const { UnauthorizedError, ForbiddenError } = await import("./account");

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("requireSuperAdmin", () => {
  it("resolves when the signed-in user matches SUPER_ADMIN_USER_ID", async () => {
    vi.stubEnv("SUPER_ADMIN_USER_ID", "super-1");
    createClient.mockReturnValue(makeClient({ user: { id: "super-1" } }));

    await expect(requireSuperAdmin()).resolves.toEqual({ userId: "super-1" });
  });

  it("throws ForbiddenError for a signed-in user who isn't the super admin", async () => {
    vi.stubEnv("SUPER_ADMIN_USER_ID", "super-1");
    createClient.mockReturnValue(makeClient({ user: { id: "some-other-user" } }));

    await expect(requireSuperAdmin()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws UnauthorizedError when there's no session", async () => {
    vi.stubEnv("SUPER_ADMIN_USER_ID", "super-1");
    createClient.mockReturnValue(makeClient({ user: null }));

    await expect(requireSuperAdmin()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("throws ForbiddenError (not a crash) when SUPER_ADMIN_USER_ID isn't configured", async () => {
    vi.stubEnv("SUPER_ADMIN_USER_ID", "");
    createClient.mockReturnValue(makeClient({ user: { id: "anyone" } }));

    await expect(requireSuperAdmin()).rejects.toBeInstanceOf(ForbiddenError);
  });
});
