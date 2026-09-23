/**
 * Which Zernio webhook events the CRM acts on, and how.
 *
 * Kept as a pure function so the routing — the part that silently broke
 * "messages I send from my phone never show up in the CRM" — can be
 * tested without standing up the route.
 *
 * Zernio delivers a message written in the WhatsApp Business app on a
 * Coexistence number as `message.sent` with
 * `message.source === 'whatsapp_business_app'`, NOT as `message.received`
 * (that one is only for what a customer sends us). Until now the route
 * dropped every event except `message.received`, and the webhook
 * subscription (scripts/zernio-setup-webhook.js) never asked for
 * `message.sent` in the first place.
 */

export type ZernioEventKind =
  /** Delivery ticks for a message we sent: sent → delivered → read / failed. */
  | 'status'
  /** A message in the conversation, incoming or (legacy) outgoing. */
  | 'message'
  /** A message the business typed in the WhatsApp Business phone app. */
  | 'phone_sent'
  /** A previously-sent business message was deleted ("delete for
   *  everyone"). WhatsApp-only per Zernio's docs; see
   *  WebhookPayloadMessageDeleted's doc comment in @zernio/node. */
  | 'deleted'
  /** Nothing for the CRM to do. */
  | 'ignore'

export const ZERNIO_PHONE_APP_SOURCE = 'whatsapp_business_app'

export function classifyZernioEvent(payload: {
  event?: string
  message?: { source?: string | null } | null
}): ZernioEventKind {
  switch (payload.event) {
    case 'message.delivered':
    case 'message.read':
    case 'message.failed':
      return 'status'
    case 'message.received':
      return 'message'
    case 'message.deleted':
      return 'deleted'
    case 'message.sent':
      // `cloud_api` sends (this CRM, Zernio's dashboard, broadcasts) are
      // already recorded by the code that made them — recording the echo
      // too would race the CRM's own insert and duplicate the message.
      // Only the phone app is a genuinely new, external message.
      return payload.message?.source === ZERNIO_PHONE_APP_SOURCE ? 'phone_sent' : 'ignore'
    default:
      return 'ignore'
  }
}
