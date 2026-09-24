import { describe, expect, it } from "vitest";

import { marksReadOnly, sharedWithCount } from "../src/events/card";

const sharer = {
  userId: "019d6e7d-0000-7000-8000-000000000009",
  displayName: "何安",
};

function access(
  role: "owner" | "editor" | "viewer" | null,
  sharedWith = 0,
  sharedBy: typeof sharer | null = null,
) {
  return { access: { role, sharedBy, sharedWith } };
}

describe("Mini Program event cards", () => {
  it.each(["owner", "editor", null] as const)(
    "marks a view-only Event in a workspace where the role is %s",
    (workspaceRole) => {
      expect(marksReadOnly(access("viewer"), workspaceRole)).toBe(true);
    },
  );

  it("leaves Events unmarked when their access matches the workspace", () => {
    expect(marksReadOnly(access("viewer"), "viewer")).toBe(false);
    expect(marksReadOnly(access("editor"), "editor")).toBe(false);
    expect(marksReadOnly(access(null), "owner")).toBe(false);
  });

  it("counts accounts only for Events the account shared", () => {
    expect(sharedWithCount(access(null, 3))).toBe(3);
    expect(sharedWithCount(access("viewer", 2, sharer))).toBe(0);
    expect(sharedWithCount(access(null, 0))).toBe(0);
  });
});
