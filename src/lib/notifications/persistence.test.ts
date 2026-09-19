import { describe, expect, it } from "vitest";
import { isPersistentAssignment } from "./persistence";

const system = { type: "conversation_assigned", actor_user_id: undefined } as const;

describe("isPersistentAssignment", () => {
  it("persists a system (round-robin) assignment in a shared-number account", () => {
    expect(isPersistentAssignment(system, "shared")).toBe(true);
  });

  it("treats a null actor the same as a missing one", () => {
    expect(
      isPersistentAssignment(
        { type: "conversation_assigned", actor_user_id: null as unknown as undefined },
        "shared",
      ),
    ).toBe(true);
  });

  it("does not persist in a multi-WhatsApp account", () => {
    expect(isPersistentAssignment(system, "multiwhatsapp")).toBe(false);
  });

  it("does not persist while the account mode is still unknown", () => {
    expect(isPersistentAssignment(system, undefined)).toBe(false);
    expect(isPersistentAssignment(system, null)).toBe(false);
  });

  it("does not persist an assignment a teammate made by hand", () => {
    expect(
      isPersistentAssignment({ type: "conversation_assigned", actor_user_id: "u-42" }, "shared"),
    ).toBe(false);
  });

  it.each(["new_lead", "new_message", "hot_lead_unanswered", "contact_note_mention"] as const)(
    "does not persist a %s notification",
    (type) => {
      expect(isPersistentAssignment({ type, actor_user_id: undefined }, "shared")).toBe(false);
    },
  );
});
