import type { SupabaseClient } from '@supabase/supabase-js'
import type { MessageTemplate } from '@/types'
import { decrypt } from '@/lib/whatsapp/encryption'
import { sendTemplateMessage } from '@/lib/whatsapp/meta-api'
import { isMessageTemplate } from '@/lib/whatsapp/template-row-guard'
import { isValidTimezone } from '@/lib/automations/schedule'

// ============================================================
// WhatsApp confirmation/reminder sends for appointments (migration
// 079). Best-effort everywhere, same posture as scheduling-actions.ts
// / event-reminders.ts: a failure here (no WhatsApp connected, no
// template chosen yet, Meta rejects the send) must never take down the
// booking itself — it only means the customer doesn't get a WhatsApp
// message this time, and the appointment still shows up on the
// calendar for staff.
//
// Expects the account's chosen template
// (accounts.appointment_confirmation_template_id /
// appointment_reminder_template_id) to have exactly two body
// variables, in this order:
//   {{1}} — customer's name
//   {{2}} — a single human-readable line: "<service> on <weekday
//           date> at <time> with <staff name>"
// Documented here (not enforced) because Meta approves templates by
// exact wording — the Settings UI that lets an admin pick the
// template should show this contract so they draft one that fits.
// ============================================================

export type AppointmentNotificationKind = 'confirmation' | 'reminder'

export interface AppointmentNotificationArgs {
  accountId: string
  contactId: string
  contactName: string
  contactPhone: string
  serviceName: string
  staffName: string
  /** UTC ISO instant. */
  startsAt: string
  timezone: string
  kind: AppointmentNotificationKind
}

function formatAppointmentLine(
  serviceName: string,
  staffName: string,
  startsAtIso: string,
  timezone: string,
): string {
  const tz = isValidTimezone(timezone) ? timezone : 'UTC'
  const when = new Intl.DateTimeFormat('es', {
    timeZone: tz,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(startsAtIso))
  return staffName
    ? `${serviceName} el ${when} con ${staffName}`
    : `${serviceName} el ${when}`
}

/**
 * Sends the confirmation or reminder WhatsApp template to the
 * customer, if the account has both WhatsApp connected and a template
 * chosen for `kind`. Returns true iff a message was actually sent.
 */
export async function sendAppointmentNotification(
  db: SupabaseClient,
  args: AppointmentNotificationArgs,
): Promise<boolean> {
  try {
    const { data: account } = await db
      .from('accounts')
      .select('appointment_confirmation_template_id, appointment_reminder_template_id')
      .eq('id', args.accountId)
      .maybeSingle()
    const templateId =
      args.kind === 'confirmation'
        ? account?.appointment_confirmation_template_id
        : account?.appointment_reminder_template_id
    if (!templateId) return false // admin hasn't picked a template yet

    const [{ data: config }, { data: rawTemplate }] = await Promise.all([
      db.from('whatsapp_config').select('*').eq('account_id', args.accountId).maybeSingle(),
      db.from('message_templates').select('*').eq('id', templateId).maybeSingle(),
    ])
    if (!config) {
      console.warn('[booking notify] WhatsApp not configured — skipping', args.kind)
      return false
    }
    if (!rawTemplate || !isMessageTemplate(rawTemplate)) {
      console.warn('[booking notify] template row missing/malformed — skipping', args.kind)
      return false
    }
    const template = rawTemplate as MessageTemplate
    if (template.status !== 'APPROVED') {
      console.warn('[booking notify] template not yet APPROVED — skipping', args.kind)
      return false
    }

    const accessToken = decrypt(config.access_token)
    const line = formatAppointmentLine(
      args.serviceName,
      args.staffName,
      args.startsAt,
      args.timezone,
    )

    await sendTemplateMessage({
      phoneNumberId: config.phone_number_id,
      accessToken,
      to: args.contactPhone,
      templateName: template.name,
      language: template.language || 'es',
      template,
      messageParams: { body: [args.contactName, line] },
      apiBase: config.send_api_base ?? undefined,
    })

    return true
  } catch (err) {
    console.error('[booking notify] send failed:', err)
    return false
  }
}
