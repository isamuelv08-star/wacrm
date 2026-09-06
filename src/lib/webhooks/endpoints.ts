// ============================================================
// Webhook endpoint store helpers — secret generation + the public
// (secret-free) serialization used by the management API.
//
// The signing secret is stored AES-256-GCM-encrypted at rest (see
// migration 028) and returned in plaintext exactly once, at creation.
// ============================================================

import { randomBytes } from 'node:crypto';

import { isDeliverableUrl } from '@/lib/webhooks/ssrf';

/** Secret prefix — self-identifying, like `wacrm_live_` for keys. */
export const WEBHOOK_SECRET_PREFIX = 'whsec_';

/**
 * Columns safe to return over the API — everything except the
 * (encrypted) `secret`, which is only ever surfaced once at creation.
 */
export const WEBHOOK_PUBLIC_COLUMNS =
  'id, url, events, is_active, last_delivery_at, failure_count, created_at';

export interface ApiWebhookEndpoint {
  id: string;
  url: string;
  events: string[];
  is_active: boolean;
  last_delivery_at: string | null;
  failure_count: number;
  created_at: string;
}

/** Generate a fresh signing secret (full-entropy, URL/header-safe). */
export function generateWebhookSecret(): string {
  return `${WEBHOOK_SECRET_PREFIX}${randomBytes(32).toString('base64url')}`;
}

/** Project a `WEBHOOK_PUBLIC_COLUMNS` row into the API shape. */
export function serializeWebhookEndpoint(
  row: Record<string, unknown>
): ApiWebhookEndpoint {
  return {
    id: row.id as string,
    url: row.url as string,
    events: (row.events as string[] | null) ?? [],
    is_active: Boolean(row.is_active),
    last_delivery_at: (row.last_delivery_at as string | null) ?? null,
    failure_count: (row.failure_count as number | null) ?? 0,
    created_at: row.created_at as string,
  };
}

/**
 * Validate a webhook target URL: must be a well-formed absolute
 * `https://` URL (an unencrypted `http://` sink would leak signed
 * event payloads) that resolves to a publicly-routable address.
 *
 * Delivery already re-checks this at send time via the same
 * `isDeliverableUrl` guard (see src/lib/webhooks/deliver.ts) — a URL
 * that fails here would just fail every delivery attempt forever, so
 * rejecting it up front gives the caller a clear 400 instead of a
 * silently-dead endpoint. Returns the normalized string or null.
 */
export async function normalizeWebhookUrl(input: unknown): Promise<string | null> {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (!(await isDeliverableUrl(url.toString()))) return null;
  return url.toString();
}
