// ============================================================
// Outbound message send — the core that both the dashboard's
// `/api/whatsapp/send` route and the public `/api/v1/messages`
// endpoint call.
//
// Given a conversation and message params, this:
//   1. validates the params for the message type,
//   2. loads the conversation + contact + WhatsApp config,
//   3. sends to Meta (with phone-variant retry + contact auto-fix),
//   4. persists the message + updates the conversation,
//   5. pauses any active Flow run — and, for a human send, the AI bot
//      on that conversation — because the agent stepped in.
//
// It is transport-agnostic: it takes a `SupabaseClient` and an
// `accountId` and throws `SendMessageError` on failure. The callers
// own auth, rate-limiting, body parsing, and mapping the error to
// their respective response shapes (internal `{ error }` vs the v1
// envelope). Behaviour is identical to the original inline route —
// this is a straight extraction so the public endpoint can reuse it
// without duplicating ~250 lines of Meta plumbing.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  sendTextMessage,
  sendTemplateMessage,
  sendMediaMessage,
  sendInteractiveButtons,
  sendInteractiveList,
  type MediaKind,
} from '@/lib/whatsapp/meta-api';
import {
  validateInteractivePayload,
  interactivePayloadPreviewText,
  type InteractiveMessagePayload,
} from '@/lib/whatsapp/interactive';
import { decrypt, encrypt, isLegacyFormat } from '@/lib/whatsapp/encryption';
import { sendViaZernio, resolveZernioSocialAccountId } from '@/lib/whatsapp/zernio-send';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { pauseAiForAgentReply } from '@/lib/ai/thread-control';
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from '@/lib/whatsapp/phone-utils';
import type { MessageTemplate } from '@/types';
import { isMessageTemplate } from '@/lib/whatsapp/template-row-guard';
import { resolveTemplateComponents, type SendTimeParams } from '@/lib/whatsapp/template-send-builder';
import { isUniqueViolation } from '@/lib/contacts/dedupe';

export const MEDIA_KINDS = ['image', 'video', 'document', 'audio'] as const;
export const VALID_MESSAGE_TYPES = [
  'text',
  'template',
  'interactive',
  ...MEDIA_KINDS,
] as const;

/**
 * Typed failure with a machine `code` and a suggested HTTP `status`.
 * Callers map it to their own response shape (`toErrorResponse` for
 * the dashboard route, the v1 envelope for the public endpoint).
 */
export class SendMessageError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'SendMessageError';
    this.code = code;
    this.status = status;
  }
}

export interface SendMessageParams {
  conversationId: string;
  messageType: string;
  contentText?: string | null;
  mediaUrl?: string | null;
  filename?: string | null;
  templateName?: string | null;
  templateLanguage?: string | null;
  /** Legacy positional body params (only used if messageParams.body unset). */
  templateParams?: string[];
  /** Structured template params (header/body/buttons). */
  templateMessageParams?: unknown;
  /** Structured payload for `messageType === 'interactive'`. */
  interactivePayload?: InteractiveMessagePayload | null;
  replyToMessageId?: string | null;
  /**
   * The sending agent's `auth.users.id` — when set, and the conversation
   * is still unassigned, replying to it claims it for this agent (see
   * `claimConversationForAgent` below). Only the dashboard's
   * human-authenticated send route passes this; the public `/api/v1/
   * messages` endpoint deliberately doesn't, since those sends aren't a
   * salesperson "taking" a lead.
   */
  claimForUserId?: string | null;
}

export interface SendMessageResult {
  /** Our `messages.id` (the persisted row). */
  /** Our stored row id — null in the rare case the message went out but
   *  couldn't be saved (see the insert retry in sendMessageToConversation). */
  messageId: string | null;
  /** Meta's `wamid` for the delivered message. */
  whatsappMessageId: string;
}

/**
 * Send a message in an existing conversation and persist it.
 *
 * `db` may be an RLS-scoped user client (dashboard) or the service-
 * role client (public API) — every query is filtered by `accountId`
 * either way, so tenancy holds regardless of which client is passed.
 */
/**
 * Validate the message-shape params (type, required content, caption
 * cap) independently of any DB state, throwing `SendMessageError` on a
 * bad payload. Exported so a caller can reject a malformed request
 * *before* it finds-or-creates a contact/conversation — otherwise an
 * invalid payload leaves an orphan empty conversation behind. The send
 * core calls this too, so validation can't be skipped.
 */
export function validateSendMessageParams(params: {
  messageType: string;
  contentText?: string | null;
  mediaUrl?: string | null;
  templateName?: string | null;
  interactivePayload?: InteractiveMessagePayload | null;
}): void {
  const { messageType, contentText, mediaUrl, templateName, interactivePayload } =
    params;

  if (!messageType) {
    throw new SendMessageError('bad_request', 'message_type is required', 400);
  }

  const isMediaKind = (MEDIA_KINDS as readonly string[]).includes(messageType);

  if (!(VALID_MESSAGE_TYPES as readonly string[]).includes(messageType)) {
    throw new SendMessageError(
      'bad_request',
      `Unsupported message_type "${messageType}"`,
      400
    );
  }

  if (messageType === 'text' && !contentText) {
    throw new SendMessageError(
      'bad_request',
      'content_text is required for text messages',
      400
    );
  }

  if (messageType === 'template' && !templateName) {
    throw new SendMessageError(
      'bad_request',
      'template_name is required for template messages',
      400
    );
  }

  // Interactive: validate the full structured payload against Meta's
  // limits up front so a bad payload 400s before we touch Meta.
  if (messageType === 'interactive') {
    const result = validateInteractivePayload(interactivePayload);
    if (!result.ok) {
      throw new SendMessageError('bad_request', result.error, 400);
    }
  }

  if (isMediaKind && !mediaUrl) {
    throw new SendMessageError(
      'bad_request',
      `media_url is required for ${messageType} messages`,
      400
    );
  }

  // Meta caps media captions at 1024 chars (audio carries none).
  if (
    isMediaKind &&
    messageType !== 'audio' &&
    typeof contentText === 'string' &&
    contentText.length > 1024
  ) {
    throw new SendMessageError(
      'bad_request',
      'Caption exceeds the 1024-character limit',
      400
    );
  }
}

/**
 * "Reply = claim it": when an agent sends the first message on a
 * conversation nobody's handling yet, assign it to them — no manual
 * "Assign to me" click needed. Guards against stealing a lead that a
 * different mechanism (the AI's equitable distribution, lead-scoring.ts)
 * already handed to a specific rep: if the contact's open deal already
 * has an owner, the message still sends, it just doesn't change who's
 * assigned. The conversation write itself is a conditional UPDATE
 * (`assigned_agent_id IS NULL`) so two agents replying to the same
 * unassigned thread at once resolve to a single winner without a lock,
 * same pattern as `claim_ai_reply_slot`.
 */
async function claimConversationForAgent(
  db: SupabaseClient,
  args: { accountId: string; conversationId: string; contactId: string; agentUserId: string },
): Promise<void> {
  const { accountId, conversationId, contactId, agentUserId } = args;

  const { data: openDeal } = await db
    .from('deals')
    .select('assigned_to')
    .eq('contact_id', contactId)
    .eq('account_id', accountId)
    .eq('status', 'open')
    .limit(1)
    .maybeSingle();
  if (openDeal?.assigned_to) return;

  await db
    .from('conversations')
    .update({ assigned_agent_id: agentUserId })
    .eq('id', conversationId)
    .is('assigned_agent_id', null);
}

export async function sendMessageToConversation(
  db: SupabaseClient,
  accountId: string,
  params: SendMessageParams
): Promise<SendMessageResult> {
  const {
    conversationId,
    messageType,
    contentText,
    mediaUrl,
    filename,
    templateName,
    templateLanguage,
    templateParams,
    templateMessageParams,
    interactivePayload,
    replyToMessageId,
    claimForUserId,
  } = params;

  if (!conversationId) {
    throw new SendMessageError(
      'bad_request',
      'conversation_id is required',
      400
    );
  }

  validateSendMessageParams({
    messageType,
    contentText,
    mediaUrl,
    templateName,
    interactivePayload,
  });

  const isMediaKind = (MEDIA_KINDS as readonly string[]).includes(messageType);

  // Conversation + contact, account-scoped.
  const { data: conversation, error: convError } = await db
    .from('conversations')
    .select('*, contact:contacts(*)')
    .eq('id', conversationId)
    .eq('account_id', accountId)
    .single();

  if (convError || !conversation) {
    throw new SendMessageError('not_found', 'Conversation not found', 404);
  }

  // "Reply = claim it": a still-unassigned conversation is handed to
  // whoever answers it first, so nobody has to remember to click
  // "Assign to me". Best-effort — never let a claim hiccup block the
  // customer-facing send that's about to happen.
  if (claimForUserId && !conversation.assigned_agent_id) {
    try {
      await claimConversationForAgent(db, {
        accountId,
        conversationId,
        contactId: conversation.contact_id as string,
        agentUserId: claimForUserId,
      });
    } catch (err) {
      console.error('[send-message] claimConversationForAgent failed:', err);
    }
  }

  const contact = conversation.contact;
  if (!contact?.phone) {
    throw new SendMessageError(
      'bad_request',
      'Contact phone number not found',
      400
    );
  }

  const sanitizedPhone = sanitizePhoneForMeta(contact.phone);
  if (!isValidE164(sanitizedPhone)) {
    throw new SendMessageError(
      'bad_request',
      'Invalid phone number format',
      400
    );
  }

  // Resolve the reply target to its Meta message_id. The parent must
  // belong to this same conversation — otherwise a caller could quote
  // messages they can't see by guessing UUIDs. Shared by both the
  // direct-Meta and Zernio branches below.
  let contextMessageId: string | undefined;
  if (replyToMessageId) {
    const { data: parent, error: parentError } = await db
      .from('messages')
      .select('message_id, conversation_id')
      .eq('id', replyToMessageId)
      .eq('conversation_id', conversationId)
      .maybeSingle();

    if (parentError || !parent) {
      throw new SendMessageError(
        'bad_request',
        'reply_to_message_id not found in this conversation',
        400
      );
    }
    if (!parent.message_id) {
      console.warn(
        '[send-message] reply target has no Meta message_id; sending without context'
      );
    } else {
      contextMessageId = parent.message_id;
    }
  }

  // Zernio-bridged accounts have no whatsapp_config row at all — Zernio
  // holds the Meta credentials itself (see zernio-send.ts). Branch out
  // to that path entirely before touching whatsapp_config, which would
  // otherwise 400 with "not configured" for every Zernio account.
  const zernioSocialAccountId = await resolveZernioSocialAccountId(db, accountId);

  let waMessageId = '';

  if (zernioSocialAccountId) {
    // Same template row + components the Meta branch builds, so media
    // headers and URL buttons reach Zernio too.
    const zernioTemplateRow =
      messageType === 'template' && templateName
        ? await loadTemplateRow(db, accountId, templateName, templateLanguage)
        : null;
    const templateComponents =
      messageType === 'template'
        ? resolveTemplateComponents(
            zernioTemplateRow,
            (templateMessageParams as SendTimeParams | undefined) ?? undefined,
            templateParams,
          )
        : undefined;
    const result = await sendViaZernio(
      zernioSocialAccountId,
      (conversation.zernio_conversation_id as string | null) ?? null,
      sanitizedPhone,
      {
        messageType,
        contentText,
        mediaUrl,
        filename,
        templateName,
        templateLanguage,
        templateParams,
        templateComponents,
      },
      contextMessageId,
      interactivePayload,
    );
    waMessageId = result.waMessageId;
    if (result.zernioConversationId) {
      await db
        .from('conversations')
        .update({ zernio_conversation_id: result.zernioConversationId })
        .eq('id', conversationId);
    }
  } else {
    // WhatsApp config. Prefer the SPECIFIC number this conversation is
    // tagged with (migration 084) — required once an account has more
    // than one direct-Meta number (multiwhatsapp mode, migration 085),
    // since the plain account-scoped .single() below throws on 2+
    // rows. Untagged conversations (everything before 084, or an
    // account that's never had more than one number) fall through to
    // the original account-wide lookup unchanged — same row, same
    // behavior as before this existed.
    const { data: config, error: configError } = conversation.whatsapp_config_id
      ? await db
          .from('whatsapp_config')
          .select('*')
          .eq('id', conversation.whatsapp_config_id as string)
          .eq('account_id', accountId)
          .maybeSingle()
      : await db
          .from('whatsapp_config')
          .select('*')
          .eq('account_id', accountId)
          // No number tagged on the thread: the account's oldest number
          // (same pick broadcasts use). `.single()` threw once a
          // multiwhatsapp account had 2+ numbers — "WhatsApp not configured".
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle();

    if (configError || !config) {
      throw new SendMessageError(
        'whatsapp_not_configured',
        'WhatsApp not configured. Please set up your WhatsApp integration first.',
        400
      );
    }

    const accessToken = decrypt(config.access_token);

    // Self-heal legacy CBC ciphertexts. Fire-and-forget; idempotent.
    if (isLegacyFormat(config.access_token)) {
      void db
        .from('whatsapp_config')
        .update({ access_token: encrypt(accessToken) })
        .eq('id', config.id)
        .then(({ error }: { error: { message: string } | null }) => {
          if (error) {
            console.warn(
              '[send-message] access_token GCM upgrade failed:',
              error.message
            );
          }
        });
    }

    // Template row (for header + button components). isMessageTemplate
    // guards against a malformed local row crashing the send-builder.
    const templateRow: MessageTemplate | null =
      messageType === 'template' && templateName
        ? await loadTemplateRow(db, accountId, templateName, templateLanguage)
        : null;

    const attempt = async (phone: string): Promise<string> => {
      if (messageType === 'template') {
        const result = await sendTemplateMessage({
          phoneNumberId: config.phone_number_id,
          accessToken,
          to: phone,
          templateName: templateName!,
          language: templateLanguage || 'en_US',
          template: templateRow ?? undefined,
          messageParams: templateMessageParams ?? undefined,
          params: templateParams || [],
          contextMessageId,
          apiBase: config.send_api_base ?? undefined,
        });
        return result.messageId;
      }
      if (isMediaKind) {
        const result = await sendMediaMessage({
          phoneNumberId: config.phone_number_id,
          accessToken,
          to: phone,
          kind: messageType as MediaKind,
          link: mediaUrl!,
          caption: contentText || undefined,
          filename: filename || undefined,
          contextMessageId,
          apiBase: config.send_api_base ?? undefined,
        });
        return result.messageId;
      }
      if (messageType === 'interactive') {
        const p = interactivePayload!;
        if (p.kind === 'buttons') {
          const result = await sendInteractiveButtons({
            phoneNumberId: config.phone_number_id,
            accessToken,
            to: phone,
            bodyText: p.body,
            headerText: p.header || undefined,
            footerText: p.footer || undefined,
            buttons: p.buttons,
            contextMessageId,
            apiBase: config.send_api_base ?? undefined,
          });
          return result.messageId;
        }
        const result = await sendInteractiveList({
          phoneNumberId: config.phone_number_id,
          accessToken,
          to: phone,
          bodyText: p.body,
          buttonLabel: p.button_label,
          headerText: p.header || undefined,
          footerText: p.footer || undefined,
          sections: p.sections,
          contextMessageId,
          apiBase: config.send_api_base ?? undefined,
        });
        return result.messageId;
      }
      const result = await sendTextMessage({
        phoneNumberId: config.phone_number_id,
        accessToken,
        to: phone,
        text: contentText!,
        contextMessageId,
        apiBase: config.send_api_base ?? undefined,
      });
      return result.messageId;
    };

    // Send via Meta — retry across phone-number variants if Meta rejects
    // with "recipient not in allowed list"; persist a working variant
    // back to the contact so the next send goes straight through.
    let workingPhone = sanitizedPhone;
    try {
      const variants = phoneVariants(sanitizedPhone);
      let lastError: unknown = null;

      for (const variant of variants) {
        try {
          waMessageId = await attempt(variant);
          workingPhone = variant;
          lastError = null;
          break;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (!isRecipientNotAllowedError(message)) {
            throw err;
          }
          lastError = err;
          console.warn(
            `[send-message] variant "${variant}" rejected by Meta, trying next…`
          );
        }
      }

      if (lastError) throw lastError;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unknown Meta API error';
      console.error('[send-message] Meta send failed for all variants:', message);
      throw new SendMessageError('meta_error', `Meta API error: ${message}`, 502);
    }

    if (workingPhone !== sanitizedPhone) {
      console.log(
        `[send-message] Auto-corrected contact phone: ${sanitizedPhone} → ${workingPhone}`
      );
      await db
        .from('contacts')
        .update({ phone: workingPhone })
        .eq('id', contact.id);
    }
  }

  // Persist the sent message. Field names MUST match the messages
  // schema (see 001_initial_schema.sql).
  // Interactive messages persist the body as content_text (so the
  // conversation-list preview reads sensibly) plus the full structured
  // payload so the thread can re-render the buttons / rows.
  const interactiveBody =
    messageType === 'interactive' ? interactivePayload!.body : null;

  // The message has ALREADY gone out at this point, so a failure here
  // must never surface as a send error — the agent would retry and the
  // customer would get it twice. Retry transient DB errors, treat a
  // unique conflict (the provider's echo recorded it first) as saved,
  // and otherwise report success without a stored row (a resync picks
  // it up if the echo lands later).
  const row = {
    conversation_id: conversationId,
    sender_type: 'agent',
    content_type: messageType,
    content_text: interactiveBody ?? contentText ?? null,
    media_url: mediaUrl || null,
    template_name: templateName || null,
    interactive_payload: messageType === 'interactive' ? interactivePayload : null,
    message_id: waMessageId,
    status: 'sent',
    reply_to_message_id: replyToMessageId || null,
  };
  let messageRecord: { id: string } | null = null;
  for (let attempt = 0; attempt < 3 && !messageRecord; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, attempt * 400));
    const { data, error: msgError } = await db.from('messages').insert(row).select('id').single();
    if (!msgError && data) {
      messageRecord = data as { id: string };
      break;
    }
    if (msgError && isUniqueViolation(msgError) && waMessageId) {
      const { data: existing } = await db
        .from('messages')
        .update({ sender_type: 'agent' })
        .eq('conversation_id', conversationId)
        .eq('message_id', waMessageId)
        .select('id')
        .maybeSingle();
      if (existing) messageRecord = existing as { id: string };
      break;
    }
    console.error(`[send-message] saving the sent message failed (attempt ${attempt + 1}):`, msgError);
  }

  const lastMessageText =
    messageType === 'interactive'
      ? interactivePayloadPreviewText(interactivePayload!)
      : contentText || `[${messageType}]`;

  await db
    .from('conversations')
    .update({
      last_message_text: lastMessageText,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversationId);

  // Pause any active Flow run for this contact — the agent stepping in
  // is the strongest "yield, human is here" signal. Best-effort.
  try {
    const { error: pauseErr } = await supabaseAdmin()
      .from('flow_runs')
      .update({
        status: 'paused_by_agent',
        ended_at: new Date().toISOString(),
        end_reason: 'agent_replied',
      })
      .eq('account_id', accountId)
      .eq('contact_id', contact.id)
      .eq('status', 'active');
    if (pauseErr) {
      console.error('[flows] pause-on-agent-send failed:', pauseErr.message);
    }
  } catch (err) {
    console.error(
      '[flows] pause-on-agent-send threw:',
      err instanceof Error ? err.message : err
    );
  }

  // Same "yield, human is here" signal for the AI bot (migration 102).
  // Gated on `claimForUserId` because that is what marks this send as a
  // person typing in the dashboard: the bot's own auto-replies, flow
  // steps and automations all send through `engineSendText` instead and
  // never reach this function, and the public API deliberately doesn't
  // pass it either — an integration posting a message isn't a
  // salesperson taking the thread.
  if (claimForUserId) {
    await pauseAiForAgentReply({ accountId, conversationId });
  }

  return { messageId: messageRecord?.id ?? null, whatsappMessageId: waMessageId };
}

/**
 * The stored template row (for header + button components).
 * isMessageTemplate guards against a malformed local row crashing the
 * send-builder.
 */
async function loadTemplateRow(
  db: SupabaseClient,
  accountId: string,
  templateName: string,
  templateLanguage: string | null | undefined,
): Promise<MessageTemplate | null> {
  const { data } = await db
    .from('message_templates')
    .select('*')
    .eq('account_id', accountId)
    .eq('name', templateName)
    .eq('language', templateLanguage || 'en_US')
    .maybeSingle();
  if (data && !isMessageTemplate(data)) {
    throw new SendMessageError(
      'template_malformed',
      'Template row is malformed locally — run "Sync from Meta" in Settings to repair it.',
      500
    );
  }
  return data ?? null;
}
