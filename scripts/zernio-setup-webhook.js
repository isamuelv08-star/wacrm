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
// safe (Zernio caps accounts at 50 webhook subscriptions total). Also
// self-heals an EXISTING webhook that's missing one of the events
// below (e.g. a deployment set up before message.delivered/read/failed
// were added here) by PATCHing its event list in place — no need to
// delete and recreate it in the Zernio dashboard.
// ============================================================

const Zernio = require('@zernio/node').default

// message.received: inbound messages. message.delivered/read/failed:
// delivery-tick updates for messages WE sent — without these,
// src/app/api/whatsapp/webhook/zernio/route.ts never learns a sent
// message was delivered/read, so the inbox gets stuck showing a
// single grey check forever instead of progressing to the double
// check (delivered) / blue double check (read) WhatsApp itself shows.
const REQUIRED_EVENTS = ['message.received', 'message.delivered', 'message.read', 'message.failed']

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
    const currentEvents = already.events || []
    const missing = REQUIRED_EVENTS.filter((e) => !currentEvents.includes(e))
    if (missing.length === 0) {
      console.log(`A webhook already points at ${webhookUrl} (id ${already._id}) with every required event. Nothing to do.`)
      console.log(
        'If you rotated ZERNIO_WEBHOOK_SECRET, delete that webhook in the Zernio dashboard and re-run this script.',
      )
      return
    }

    console.log(`Webhook ${already._id} is missing: ${missing.join(', ')}. Updating its event list...`)
    const { data, error } = await zernio.webhooks.updateWebhookSettings({
      body: { _id: already._id, events: REQUIRED_EVENTS },
    })
    if (error || !data?.success) {
      console.error('Failed to update webhook:', error || data)
      process.exit(1)
    }
    console.log(`Webhook ${already._id} updated — now subscribed to: ${REQUIRED_EVENTS.join(', ')}`)
    return
  }

  const { data, error } = await zernio.webhooks.createWebhookSettings({
    body: {
      name: 'wacrm inbound (message.received + status)',
      url: webhookUrl,
      events: REQUIRED_EVENTS,
      secret,
    },
  })

  if (error || !data?.success) {
    console.error('Failed to create webhook:', error || data)
    process.exit(1)
  }

  console.log(`Webhook created (id ${data.webhook?._id}) → ${webhookUrl}`)
  console.log('Inbound WhatsApp messages and delivery/read status from Zernio-connected accounts should now flow into the inbox.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
