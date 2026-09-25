import { describe, it, expect } from "vitest";
import {
  CONVERSATION_PAGE_SIZE,
  cursorAfter,
  matchesContactFilters,
  mergeConversationRows,
  mergeFirstPage,
  normalizeConversation,
} from "./conversations";
import type { Conversation } from "@/types";

function makeConversation(
  contact: Partial<Conversation["contact"]> | null,
): Conversation {
  return {
    id: "c1",
    user_id: "u1",
    contact_id: "ct1",
    status: "open",
    unread_count: 0,
    created_at: "",
    updated_at: "",
    contact: contact
      ? {
          id: "ct1",
          user_id: "u1",
          account_id: "a1",
          phone: "123",
          created_at: "",
          updated_at: "",
          ...contact,
        }
      : undefined,
  };
}

const tag = (id: string, name = id) => ({
  id,
  user_id: "u1",
  name,
  color: "#fff",
  created_at: "",
});

describe("matchesContactFilters", () => {
  it("matches everything when no filters are set", () => {
    const conv = makeConversation({ company: "Acme", tags: [tag("t1")] });
    expect(matchesContactFilters(conv, { tagIds: [], company: null })).toBe(
      true,
    );
    expect(makeConversation(null)).toBeDefined();
    expect(
      matchesContactFilters(makeConversation(null), {
        tagIds: [],
        company: null,
      }),
    ).toBe(true);
  });

  it("uses OR logic across tags", () => {
    const conv = makeConversation({ tags: [tag("t1"), tag("t2")] });
    expect(
      matchesContactFilters(conv, { tagIds: ["t2", "t9"], company: null }),
    ).toBe(true);
    expect(
      matchesContactFilters(conv, { tagIds: ["t9"], company: null }),
    ).toBe(false);
  });

  it("excludes conversations whose contact has no tags when a tag filter is active", () => {
    const conv = makeConversation({ tags: [] });
    expect(
      matchesContactFilters(conv, { tagIds: ["t1"], company: null }),
    ).toBe(false);
    expect(
      matchesContactFilters(makeConversation(null), {
        tagIds: ["t1"],
        company: null,
      }),
    ).toBe(false);
  });

  it("matches company exactly, trimming whitespace", () => {
    const conv = makeConversation({ company: "  Acme  " });
    expect(
      matchesContactFilters(conv, { tagIds: [], company: "Acme" }),
    ).toBe(true);
    expect(
      matchesContactFilters(conv, { tagIds: [], company: "Other" }),
    ).toBe(false);
  });

  it("requires both tag and company to match when both are set (AND across facets)", () => {
    const conv = makeConversation({ company: "Acme", tags: [tag("t1")] });
    expect(
      matchesContactFilters(conv, { tagIds: ["t1"], company: "Acme" }),
    ).toBe(true);
    expect(
      matchesContactFilters(conv, { tagIds: ["t1"], company: "Other" }),
    ).toBe(false);
    expect(
      matchesContactFilters(conv, { tagIds: ["tX"], company: "Acme" }),
    ).toBe(false);
  });
});

describe("normalizeConversation", () => {
  it("flattens embedded contact_tags into contact.tags", () => {
    const raw = {
      id: "c1",
      user_id: "u1",
      contact_id: "ct1",
      status: "open" as const,
      unread_count: 0,
      created_at: "",
      updated_at: "",
      contact: {
        id: "ct1",
        user_id: "u1",
        account_id: "a1",
        phone: "123",
        created_at: "",
        updated_at: "",
        contact_tags: [{ tags: tag("t1", "VIP") }, { tags: null }],
      },
    };
    const normalized = normalizeConversation(raw);
    expect(normalized.contact?.tags).toEqual([tag("t1", "VIP")]);
    // The raw join key is dropped from the flattened contact.
    expect(
      (normalized.contact as unknown as Record<string, unknown>).contact_tags,
    ).toBeUndefined();
  });

  it("passes through a conversation with no contact", () => {
    const raw = {
      id: "c1",
      user_id: "u1",
      contact_id: "ct1",
      status: "open" as const,
      unread_count: 0,
      created_at: "",
      updated_at: "",
      contact: null,
    };
    // A contactless row passes through untouched (consumers use `?.`).
    expect(normalizeConversation(raw).contact).toBeNull();
  });
});

describe('conversation pagination merges', () => {
  const conv = (id: string, at: string | null) => ({ id, last_message_at: at }) as unknown as Conversation

  it('mergeConversationRows dedupes (incoming wins) and keeps newest-first order', () => {
    const prev = [conv('b', '2026-09-20T00:00:00Z'), conv('a', '2026-09-10T00:00:00Z')]
    const merged = mergeConversationRows(prev, [
      conv('a', '2026-09-25T00:00:00Z'),
      conv('c', '2026-09-01T00:00:00Z'),
    ])
    expect(merged.map((c) => c.id)).toEqual(['a', 'b', 'c'])
  })

  it('mergeFirstPage keeps older pages but drops rows the new page should have contained', () => {
    const page = Array.from({ length: CONVERSATION_PAGE_SIZE }, (_, i) =>
      conv(`p${String(i).padStart(3, '0')}`, new Date(Date.UTC(2026, 8, 25) - i * 60_000).toISOString()),
    )
    const oldest = page[page.length - 1].last_message_at!
    const prev = [
      conv('gone', new Date(Date.parse(oldest) + 1000).toISOString()), // inside the page's range, not in it
      conv('older', '2026-01-01T00:00:00Z'),
    ]
    const merged = mergeFirstPage(prev, page)
    expect(merged).toHaveLength(CONVERSATION_PAGE_SIZE + 1)
    expect(merged.some((c) => c.id === 'older')).toBe(true)
    expect(merged.some((c) => c.id === 'gone')).toBe(false)
  })

  it('mergeFirstPage with a short page replaces everything', () => {
    const merged = mergeFirstPage([conv('old', '2026-01-01T00:00:00Z')], [conv('x', '2026-09-01T00:00:00Z')])
    expect(merged.map((c) => c.id)).toEqual(['x'])
  })

  it('cursorAfter points at the last row', () => {
    expect(cursorAfter([conv('a', '2026-09-02T00:00:00Z'), conv('b', null)])).toEqual({ lastMessageAt: null, id: 'b' })
    expect(cursorAfter([])).toBeNull()
  })
})
