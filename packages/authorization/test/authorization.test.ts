import { describe, expect, it, vi } from "vitest";

import {
  AuthorizationDeniedError,
  AuthorizationService,
  roleAllows,
  type AuthorizationStore,
  type ResourceRef,
  type UserPrincipal,
} from "../src/authorization.js";

const principal: UserPrincipal = {
  type: "user",
  userId: "00000000-0000-7000-8000-000000000001",
  workspaceId: "00000000-0000-7000-8000-000000000002",
};
const resource: ResourceRef = {
  id: "00000000-0000-7000-8000-000000000003",
  workspaceId: principal.workspaceId,
};

describe("roleAllows", () => {
  it("implements the owner, editor, and viewer capability matrix", () => {
    expect(roleAllows("owner", "delete")).toBe(true);
    expect(roleAllows("editor", "comment")).toBe(true);
    expect(roleAllows("editor", "share")).toBe(false);
    expect(roleAllows("viewer", "view")).toBe(true);
    expect(roleAllows("viewer", "edit")).toBe(false);
  });
});

describe("AuthorizationService", () => {
  it("accepts any applicable role that permits the action", async () => {
    const store: AuthorizationStore = {
      findResourceRoles: vi.fn().mockResolvedValue(["viewer", "editor"]),
      hasWorkspaceAccess: vi.fn().mockResolvedValue(true),
    };
    const authorization = new AuthorizationService(store);

    await expect(authorization.can(principal, "edit", resource)).resolves.toBe(
      true,
    );
  });

  it("denies a cross-workspace reference before querying the store", async () => {
    const findResourceRoles = vi.fn();
    const store: AuthorizationStore = {
      findResourceRoles,
      hasWorkspaceAccess: vi.fn(),
    };
    const authorization = new AuthorizationService(store);

    await expect(
      authorization.can(principal, "view", {
        ...resource,
        workspaceId: "00000000-0000-7000-8000-000000000004",
      }),
    ).resolves.toBe(false);
    expect(findResourceRoles).not.toHaveBeenCalled();
  });

  it("uses one generic error for missing and unauthorized resources", async () => {
    const store: AuthorizationStore = {
      findResourceRoles: vi.fn().mockResolvedValue(null),
      hasWorkspaceAccess: vi.fn().mockResolvedValue(false),
    };
    const authorization = new AuthorizationService(store);

    await expect(
      authorization.assertCan(principal, "view", resource),
    ).rejects.toEqual(new AuthorizationDeniedError());
  });
});
