import { describe, it, expect } from 'vitest';
import {
  generateWebhookSecret,
  serializeWebhookEndpoint,
  normalizeWebhookUrl,
  WEBHOOK_SECRET_PREFIX,
} from './endpoints';

describe('generateWebhookSecret', () => {
  it('is prefixed and high-entropy, and unique per call', () => {
    const a = generateWebhookSecret();
    const b = generateWebhookSecret();
    expect(a.startsWith(WEBHOOK_SECRET_PREFIX)).toBe(true);
    expect(a.length).toBeGreaterThan(WEBHOOK_SECRET_PREFIX.length + 20);
    expect(a).not.toBe(b);
  });
});

describe('serializeWebhookEndpoint', () => {
  it('projects public fields and never leaks the secret', () => {
    const out = serializeWebhookEndpoint({
      id: 'w1',
      account_id: 'acct',
      created_by: 'u1',
      url: 'https://example.com/hook',
      secret: 'encrypted-blob',
      events: ['message.received'],
      is_active: true,
      last_delivery_at: null,
      failure_count: 0,
      created_at: '2026-01-01T00:00:00Z',
    });
    expect(out).not.toHaveProperty('secret');
    expect(out).not.toHaveProperty('account_id');
    expect(out).toEqual({
      id: 'w1',
      url: 'https://example.com/hook',
      events: ['message.received'],
      is_active: true,
      last_delivery_at: null,
      failure_count: 0,
      created_at: '2026-01-01T00:00:00Z',
    });
  });
});

describe('normalizeWebhookUrl', () => {
  it('accepts https to a public address and normalizes', async () => {
    // A literal public IP, not a hostname — avoids a real DNS lookup in
    // this test while still exercising the isDeliverableUrl check.
    expect(await normalizeWebhookUrl('  https://8.8.8.8/hook  ')).toBe(
      'https://8.8.8.8/hook'
    );
  });

  it('rejects http, non-URLs, and non-strings', async () => {
    expect(await normalizeWebhookUrl('http://example.com/hook')).toBeNull();
    expect(await normalizeWebhookUrl('not a url')).toBeNull();
    expect(await normalizeWebhookUrl(123)).toBeNull();
  });

  it('rejects a URL that resolves to a private/internal address', async () => {
    expect(await normalizeWebhookUrl('https://127.0.0.1/hook')).toBeNull();
    expect(await normalizeWebhookUrl('https://localhost/hook')).toBeNull();
    expect(await normalizeWebhookUrl('https://169.254.169.254/hook')).toBeNull();
  });
});
