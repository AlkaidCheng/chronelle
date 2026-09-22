import { describe, expect, it } from "vitest";

import { canCreateInActiveWorkspace } from "../src/auth/workspace-access";

const workspaceId = "019d6e7d-0000-7000-8000-000000000001";

function session(role: "owner" | "editor" | "viewer" | null) {
  return {
    availableWorkspaces: [
      {
        displayName: "Personal",
        id: workspaceId,
        ownerDisplayName: "Example User",
        personal: true,
        role,
      },
    ],
    workspace: { displayName: "Personal", id: workspaceId },
  };
}

describe("Mini Program workspace access", () => {
  it.each(["owner", "editor"] as const)(
    "allows %s members to create canonical objects",
    (role) => {
      expect(canCreateInActiveWorkspace(session(role))).toBe(true);
    },
  );

  it.each(["viewer", null] as const)(
    "does not offer creation to %s access",
    (role) => {
      expect(canCreateInActiveWorkspace(session(role))).toBe(false);
    },
  );

  it("fails closed when the active workspace is absent", () => {
    expect(
      canCreateInActiveWorkspace({
        ...session("owner"),
        availableWorkspaces: [],
      }),
    ).toBe(false);
  });
});
