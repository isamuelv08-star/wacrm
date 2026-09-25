import type { Conversation, Contact, Tag } from "@/types";

/**
 * Conversation select that embeds the contact plus its tags, so the Inbox
 * can filter conversations by contact tag without a second round-trip.
 * `contact_tags(tags(*))` returns the join rows; {@link normalizeConversation}
 * flattens them onto `contact.tags`.
 */
export const CONVERSATION_SELECT =
  "*, contact:contacts(*, contact_tags(tags(*)))";

/** Raw shape returned by {@link CONVERSATION_SELECT} before flattening. */
type RawContact = Contact & { contact_tags?: { tags: Tag | null }[] };
type RawConversation = Omit<Conversation, "contact"> & {
  contact?: RawContact | null;
};

/**
 * Flatten the embedded `contact_tags(tags(*))` join into `contact.tags`.
 * Safe to call on rows fetched with {@link CONVERSATION_SELECT}; a row with
 * no contact (e.g. a freshly-inserted conversation) passes through untouched.
 */
export function normalizeConversation(raw: RawConversation): Conversation {
  const rawContact = raw.contact;
  if (!rawContact) return raw as Conversation;

  const { contact_tags, ...contact } = rawContact;
  return {
    ...raw,
    contact: {
      ...contact,
      tags: (contact_tags ?? [])
        .map((ct) => ct.tags)
        .filter((t): t is Tag => t != null),
    },
  };
}

export function normalizeConversations(
  rows: RawConversation[],
): Conversation[] {
  return rows.map(normalizeConversation);
}

export interface ContactFilters {
  /** Tag ids; a conversation matches if its contact has ANY of them (OR). */
  tagIds: string[];
  /** Exact company match, or null for no company filter. */
  company: string | null;
}

/**
 * Whether a conversation passes the contact-based Inbox filters (issue #272).
 * Empty `tagIds` and null `company` are no-ops, so the default (no filters)
 * always matches. Tags use OR logic, consistent with Broadcast audiences.
 */
export function matchesContactFilters(
  conversation: Conversation,
  { tagIds, company }: ContactFilters,
): boolean {
  if (tagIds.length > 0) {
    const contactTagIds = conversation.contact?.tags ?? [];
    if (!contactTagIds.some((t) => tagIds.includes(t.id))) return false;
  }

  if (company !== null && conversation.contact?.company?.trim() !== company) {
    return false;
  }

  return true;
}

/** Conversations fetched per page in the Inbox list. */
export const CONVERSATION_PAGE_SIZE = 300;

/** Keyset cursor: the last row of the page (last_message_at desc, id desc). */
export interface ConversationCursor {
  lastMessageAt: string | null;
  id: string;
}

export function cursorAfter(rows: Conversation[]): ConversationCursor | null {
  const last = rows[rows.length - 1];
  return last ? { lastMessageAt: last.last_message_at ?? null, id: last.id } : null;
}

/** Newest first, same order as the list query (nulls first, like Postgres DESC). */
function compareByRecency(a: Conversation, b: Conversation): number {
  const at = a.last_message_at ? Date.parse(a.last_message_at) : Infinity;
  const bt = b.last_message_at ? Date.parse(b.last_message_at) : Infinity;
  if (at !== bt) return bt - at;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/**
 * Add rows (a further page, server-side search hits, a deep-linked
 * thread) to the loaded list: unique by id, the incoming copy wins,
 * kept in list order.
 */
export function mergeConversationRows(prev: Conversation[], incoming: Conversation[]): Conversation[] {
  const byId = new Map(prev.map((c) => [c.id, c]));
  for (const c of incoming) byId.set(c.id, c);
  return [...byId.values()].sort(compareByRecency);
}

/**
 * A fresh FIRST page (initial load or resync) replaces the newest part
 * of the list but must not drop older pages the agent already scrolled
 * into, nor search hits: keep previously loaded rows that are older
 * than the new page's oldest row. Rows the new page doesn't contain
 * but that would fall inside its range are gone server-side (closed,
 * merged) and are dropped.
 */
export function mergeFirstPage(prev: Conversation[], firstPage: Conversation[]): Conversation[] {
  if (firstPage.length < CONVERSATION_PAGE_SIZE) {
    // The first page is everything that exists — nothing older to keep.
    return [...firstPage].sort(compareByRecency);
  }
  const oldest = firstPage[firstPage.length - 1];
  const inPage = new Set(firstPage.map((c) => c.id));
  const older = prev.filter((c) => !inPage.has(c.id) && compareByRecency(oldest, c) < 0);
  return [...firstPage, ...older].sort(compareByRecency);
}

/** Same as CONVERSATION_SELECT, but inner-joined on the contact so a
 *  filter on the contact (server-side search) filters conversations. */
export const CONVERSATION_SELECT_CONTACT_INNER =
  "*, contact:contacts!inner(*, contact_tags(tags(*)))";
