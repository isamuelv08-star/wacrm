// ============================================================
// Account role helpers — pure, unit-testable, no I/O.
//
// Mirrors the `account_role_enum` Postgres type from migration
// 017_account_sharing.sql. The hierarchy is intentionally a flat
// ordinal (owner=4 … viewer=1) — it matches the same CASE
// expression the `is_account_member(account_id, min_role)` SQL
// helper uses, so server-side TypeScript guards and database-side
// RLS speak the same language.
//
// Predicates (`canManageMembers`, `canEditSettings`, …) are the
// single source of truth for "what can this role do?" — both
// API route guards and UI gates should call them rather than
// open-coding their own role checks. That keeps role-policy
// changes a one-file diff.
// ============================================================

export type AccountRole = "owner" | "admin" | "agent" | "viewer";

/** Ordered list of every valid role, lowest privilege first. */
export const ACCOUNT_ROLES: readonly AccountRole[] = [
  "viewer",
  "agent",
  "admin",
  "owner",
] as const;

/**
 * Numeric rank of a role. Higher = more privileged. Mirrors the
 * CASE expression in `is_account_member` so JS/SQL stay aligned.
 */
export function roleRank(role: AccountRole): number {
  switch (role) {
    case "owner":
      return 4;
    case "admin":
      return 3;
    case "agent":
      return 2;
    case "viewer":
      return 1;
  }
}

/**
 * True iff `role` is at least as privileged as `min`. Use this
 * for any "user has at least admin" / "at least agent" checks.
 */
export function hasMinRole(role: AccountRole, min: AccountRole): boolean {
  return roleRank(role) >= roleRank(min);
}

/** Type-narrow an unknown string into a valid `AccountRole`. */
export function isAccountRole(value: unknown): value is AccountRole {
  return (
    typeof value === "string" &&
    (ACCOUNT_ROLES as readonly string[]).includes(value)
  );
}

// ============================================================
// Capability predicates
//
// Every UI gate and API route guard should call one of these
// instead of comparing role strings inline. Adding a capability
// = one new predicate here + one call site change per consumer.
// ============================================================

/** Owner / admin: invite, remove, change roles. */
export function canManageMembers(role: AccountRole): boolean {
  return hasMinRole(role, "admin");
}

/**
 * Owner / admin: edit account-wide settings (WhatsApp config,
 * message templates, pipelines, tags, custom fields, account
 * name). Excludes per-user settings like avatar or own password.
 */
export function canEditSettings(role: AccountRole): boolean {
  return hasMinRole(role, "admin");
}

/**
 * Owner / admin / agent: write operational data — send messages,
 * create contacts, move deals, run broadcasts, edit automations.
 * Viewers are read-only.
 */
export function canSendMessages(role: AccountRole): boolean {
  return hasMinRole(role, "agent");
}

/**
 * Viewer: read-only across everything. Provided as a positive
 * predicate so UI gates read naturally (`if (canViewOnly(role))`
 * shows the "Read-only" tooltip without inverting `canSendMessages`).
 */
export function canViewOnly(role: AccountRole): boolean {
  return role === "viewer";
}

/** Owner only: irreversible destructive operations. */
export function canDeleteAccount(role: AccountRole): boolean {
  return role === "owner";
}

/** Owner only: hand the account to another member. */
export function canTransferOwnership(role: AccountRole): boolean {
  return role === "owner";
}

// ============================================================
// Dashboard widget permissions (migration 054)
//
// The sales-facing dashboard widgets (revenue KPIs, forecast, the
// funnel, commercial metrics, the top-sellers leaderboard, and
// alerts) live on the SAME /dashboard page as the operational
// widgets everyone sees — not a separate owner-only page — but each
// one is independently grantable per member, since a sales manager
// might get the leaderboard without revenue totals, or vice versa.
//
// `profiles.dashboard_permissions` stores only the EXPLICIT
// overrides an admin has set (a partial record — most members have
// an empty object). An absent key falls back to the role default via
// `canViewDashboardSection` below, so promoting/demoting a member's
// role automatically changes what they see for anything nobody ever
// explicitly toggled — no data migration needed when the default
// itself changes.
// ============================================================

export const DASHBOARD_PERMISSION_KEYS = [
  "salesKpis",
  "salesVsGoal",
  "salesFunnel",
  "commercialMetrics",
  "topSellers",
  "alerts",
] as const;

export type DashboardPermissionKey = (typeof DASHBOARD_PERMISSION_KEYS)[number];

/** Explicit per-widget overrides for one member. Missing keys defer
 *  to the role default (see `canViewDashboardSection`). */
export type DashboardPermissions = Partial<Record<DashboardPermissionKey, boolean>>;

/** Role default when a widget was never explicitly toggled for this
 *  member: admins already manage account-wide settings, so sales
 *  visibility follows naturally; agents/viewers start closed until
 *  an admin+ opens a specific widget for them. */
function defaultDashboardPermission(role: AccountRole): boolean {
  return hasMinRole(role, "admin");
}

/**
 * Whether `role` (with `explicit` overrides) can see a given
 * dashboard widget. An explicit true/false always wins; an absent
 * key falls back to the role default.
 *
 * Callers should check `isOwner` (or `role === "owner"`) FIRST and
 * skip this entirely — an owner always sees every widget on their
 * own account's dashboard regardless of what's stored here.
 */
export function canViewDashboardSection(
  role: AccountRole,
  explicit: DashboardPermissions | null | undefined,
  key: DashboardPermissionKey,
): boolean {
  return explicit?.[key] ?? defaultDashboardPermission(role);
}

/**
 * Validate an unknown request-body value as a `DashboardPermissions`
 * object before it reaches the DB — rejects (returns null) anything
 * that isn't a plain object with boolean values and keys limited to
 * `DASHBOARD_PERMISSION_KEYS`, so a malformed/malicious payload can't
 * smuggle arbitrary JSON into `profiles.dashboard_permissions` or
 * `account_invitations.dashboard_permissions`. Shared by the
 * invitations POST route and the members PATCH route.
 */
export function parseDashboardPermissions(value: unknown): DashboardPermissions | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const out: DashboardPermissions = {};
  for (const [key, v] of Object.entries(value)) {
    if (!(DASHBOARD_PERMISSION_KEYS as readonly string[]).includes(key)) return null;
    if (typeof v !== "boolean") return null;
    out[key as DashboardPermissionKey] = v;
  }
  return out;
}
