import { describe, expect, it } from "vitest";
import { groupNotifications, MIN_NOTIFICATION_GROUP_SIZE } from "./group-notifications";
import type { Notification } from "@/types";

function n(
  id: string,
  type: Notification["type"],
  read = false,
): Notification {
  return {
    id,
    account_id: "a1",
    user_id: "u1",
    type,
    title: id,
    created_at: new Date().toISOString(),
    read_at: read ? new Date().toISOString() : undefined,
  };
}

describe("groupNotifications", () => {
  it("keeps a single message ungrouped", () => {
    const entries = groupNotifications([n("a", "new_message")]);
    expect(entries).toEqual([{ kind: "individual", notification: expect.objectContaining({ id: "a" }) }]);
    expect(MIN_NOTIFICATION_GROUP_SIZE).toBe(2);
  });

  it("groups 2+ consecutive messages", () => {
    const entries = groupNotifications([n("a", "new_message"), n("b", "new_message")]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: "group", groupKind: "messages" });
  });

  it("groups lead_qualified and lead_scored together under 'qualification'", () => {
    const entries = groupNotifications([
      n("a", "lead_qualified"),
      n("b", "lead_scored"),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: "group", groupKind: "qualification" });
  });

  it("does not merge across a non-groupable notification in between", () => {
    const entries = groupNotifications([
      n("a", "new_message"),
      n("b", "new_message"),
      n("c", "new_lead"),
      n("d", "new_message"),
    ]);
    expect(entries.map((e) => e.kind)).toEqual(["group", "individual", "individual"]);
  });

  it("leaves new_lead, conversation_assigned, hot_lead_unanswered, and lead_stale always individual", () => {
    const entries = groupNotifications([
      n("a", "new_lead"),
      n("b", "new_lead"),
      n("c", "conversation_assigned"),
      n("d", "hot_lead_unanswered"),
      n("e", "lead_stale"),
    ]);
    expect(entries.every((e) => e.kind === "individual")).toBe(true);
  });

  it("counts unread within a group", () => {
    const entries = groupNotifications([
      n("a", "new_message", false),
      n("b", "new_message", true),
      n("c", "new_message", false),
    ]);
    expect(entries[0]).toMatchObject({ kind: "group", unreadCount: 2 });
  });
});
