#!/usr/bin/env node
// ============================================================
// One-time setup: register this instance's inbound webhook with
// Zernio so WhatsApp messages actually start flowing into the CRM.
//
// Run this ONCE per deployment, after setting these env vars:
//   ZERNIO_API_KEY        — same key already used by /api/zernio/connect
//   ZERNIO_WEBHOOK_SECRET — a new long random string YOU generate
//                           (e.g. `openssl rand -hex 32`); verified
//                           against Zernio's X-Zernio-Signature header
//                           by src/app/api/whatsapp/webhook/zernio/route.ts
//   PUBLIC_BASE_URL       — this instance's public URL, e.g.
//                           https://crm.example.com (no trailing slash)
//
// Usage:
//   ZERNIO_API_KEY=... ZERNIO_WEBHOOK_SECRET=... PUBLIC_BASE_URL=https://crm.example.com \
//     node scripts/zernio-setup-webhook.js
//
// Idempotent: checks for an existing webhook pointed at the same URL
// before creating a new one, so re-running this after a redeploy is
// safe (Zernio caps accounts at 50 webhook subscriptions total).
// ============================================================

const Zernio = require('@zernio/node').default

async function main() {
  const apiKey = process.env.ZERNIO_API_KEY
  const secret = process.env.ZERNIO_WEBHOOK_SECRET
  const baseUrl = process.env.PUBLIC_BASE_URL

  if (!apiKey || !secret || !baseUrl) {
    console.error(
      'Missing one of ZERNIO_API_KEY, ZERNIO_WEBHOOK_SECRET, PUBLIC_BASE_URL. See the comment at the top of this script.',
    )
    process.exit(1)
  }

  const webhookUrl = `${baseUrl.replace(/\/$/, '')}/api/whatsapp/webhook/zernio`
  const zernio = new Zernio({ apiKey })

  const { data: existing, error: listError } = await zernio.webhooks.getWebhookSettings()
  if (listError) {
    console.error('Failed to list existing webhooks:', listError)
    process.exit(1)
  }

  const already = (existing?.webhooks || []).find((w) => w.url === webhookUrl)
  if (already) {
    console.log(`A webhook already points at ${webhookUrl} (id ${already._id}). Nothing to do.`)
    console.log(
      'If you rotated ZERNIO_WEBHOOK_SECRET, delete that webhook in the Zernio dashboard and re-run this script.',
    )
    return
  }

  const { data, error } = await zernio.webhooks.createWebhookSettings({
    body: {
      name: 'wacrm inbound (message.received)',
      url: webhookUrl,
      events: ['message.received'],
      secret,
    },
  })

  if (error || !data?.success) {
    console.error('Failed to create webhook:', error || data)
    process.exit(1)
  }

  console.log(`Webhook created (id ${data.webhook?._id}) → ${webhookUrl}`)
  console.log('Inbound WhatsApp messages from Zernio-connected accounts should now flow into the inbox.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
