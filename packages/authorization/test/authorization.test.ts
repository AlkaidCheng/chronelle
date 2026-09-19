import { describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

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
    expect(roleAllows("owner", "recover")).toBe(true);
    expect(roleAllows("editor", "recover")).toBe(false);
    expect(roleAllows("viewer", "recover")).toBe(false);
  });
});

describe("AuthorizationService", () => {
  it("binds query predicates to the same principal and evaluation clock", () => {
    const evaluatedAt = new Date("2030-01-01T00:00:00Z");
    const predicate = sql`false`;
    const store: AuthorizationStore = {
      resourcePredicate: vi.fn().mockReturnValue(predicate),
      findRecoverableResourceIds: vi.fn(),
      findResourceRoles: vi.fn(),
      findWorkspaceRole: vi.fn(),
      hasWorkspaceAccess: vi.fn(),
      findGrantNarrowing: vi.fn(),
      listAccessibleWorkspaceIds: vi.fn(),
    };
    const policy = new AuthorizationService(store, () => evaluatedAt);
    expect(policy.resourcePredicate(principal, "view")).toBe(predicate);
    expect(store.resourcePredicate).toHaveBeenCalledExactlyOnceWith({
      action: "view",
      evaluatedAt,
      userId: principal.userId,
      workspaceId: principal.workspaceId,
    });
  });
  it("preserves input order while deduplicating same-workspace policy reads", async () => {
    const evaluatedAt = new Date("2030-01-01T00:00:00Z");
    const clock = vi.fn(() => evaluatedAt);
    const store: AuthorizationStore = {
      resourcePredicate: vi.fn(),
      findRecoverableResourceIds: vi
        .fn()
        .mockResolvedValue(new Set([resource.id])),
      findResourceRoles: vi
        .fn()
        .mockResolvedValue(new Map([[resource.id, ["viewer"]]])),
      findWorkspaceRole: vi.fn(),
      hasWorkspaceAccess: vi.fn(),
      findGrantNarrowing: vi.fn(),
      listAccessibleWorkspaceIds: vi.fn(),
    };
    const policy = new AuthorizationService(store, clock);
    const missing = { ...resource, id: "00000000-0000-7000-8000-000000000005" };
    const foreign = { ...resource, workspaceId: "other" };
    const resources = [foreign, resource, missing, resource];
    expect(await policy.canMany(principal, "view", resources)).toEqual([
      false,
      true,
      false,
      true,
    ]);
    expect(clock).toHaveBeenCalledTimes(1);
    expect(store.findResourceRoles).toHaveBeenCalledExactlyOnceWith({
      evaluatedAt,
      resourceIds: [resource.id, missing.id],
      userId: principal.userId,
      workspaceId: principal.workspaceId,
    });
    expect(await policy.canMany(principal, "recover", resources)).toEqual([
      false,
      true,
      false,
      true,
    ]);
    expect(store.findRecoverableResourceIds).toHaveBeenCalledExactlyOnceWith({
      evaluatedAt,
      resourceIds: [resource.id, missing.id],
      userId: principal.userId,
      workspaceId: principal.workspaceId,
    });
    vi.clearAllMocks();
    expect(await policy.canMany(principal, "view", [])).toEqual([]);
    expect(await policy.canMany(principal, "recover", [foreign])).toEqual([
      false,
    ]);
    expect(await policy.allowedActionsMany(principal, [foreign])).toEqual([[]]);
    expect(store.findResourceRoles).not.toHaveBeenCalled();
    expect(store.findRecoverableResourceIds).not.toHaveBeenCalled();
    expect(clock).not.toHaveBeenCalled();
  });

  it("propagates a failed policy read without returning partial decisions", async () => {
    const failure = new Error("Policy storage unavailable");
    const store: AuthorizationStore = {
      resourcePredicate: vi.fn(),
      findRecoverableResourceIds: vi.fn().mockRejectedValue(failure),
      findResourceRoles: vi.fn().mockRejectedValue(failure),
      findWorkspaceRole: vi.fn(),
      hasWorkspaceAccess: vi.fn(),
      findGrantNarrowing: vi.fn(),
      listAccessibleWorkspaceIds: vi.fn(),
    };
    const policy = new AuthorizationService(store);
    await expect(policy.canMany(principal, "view", [resource])).rejects.toBe(
      failure,
    );
    await expect(policy.canMany(principal, "recover", [resource])).rejects.toBe(
      failure,
    );
  });

  it.each(["owner", "editor", "viewer", null] as const)(
    "restricts workspace inventory authority for role %s",
    async (role) => {
      const store: AuthorizationStore = {
        resourcePredicate: vi.fn(),
        findRecoverableResourceIds: vi.fn(),
        findResourceRoles: vi
          .fn()
          .mockResolvedValue(new Map([[resource.id, ["owner"]]])),
        findWorkspaceRole: vi.fn().mockResolvedValue(role),
        hasWorkspaceAccess: vi.fn(),
        findGrantNarrowing: vi.fn(),
        listAccessibleWorkspaceIds: vi.fn(),
      };
      const check = new AuthorizationService(store).assertWorkspaceOwner(
        principal,
      );
      if (role === "owner") await expect(check).resolves.toBeUndefined();
      else await expect(check).rejects.toBeInstanceOf(AuthorizationDeniedError);
      expect(store.findWorkspaceRole).toHaveBeenCalledWith(principal);
      expect(store.findResourceRoles).not.toHaveBeenCalled();
    },
  );
  it("uses the tombstone-aware Owner policy only for recovery, never for normal reads", async () => {
    const store: AuthorizationStore = {
      resourcePredicate: vi.fn(),
      findRecoverableResourceIds: vi
        .fn()
        .mockResolvedValue(new Set([resource.id])),
      findResourceRoles: vi.fn().mockResolvedValue(new Map()),
      findWorkspaceRole: vi.fn(),
      hasWorkspaceAccess: vi.fn(),
      findGrantNarrowing: vi.fn(),
      listAccessibleWorkspaceIds: vi.fn(),
    };
    const authorization = new AuthorizationService(store);
    await expect(
      authorization.can(principal, "recover", resource),
    ).resolves.toBe(true);
    await expect(authorization.can(principal, "view", resource)).resolves.toBe(
      false,
    );
    await expect(
      authorization.can(principal, "recover", {
        ...resource,
        workspaceId: "other",
      }),
    ).resolves.toBe(false);
    expect(store.findRecoverableResourceIds).toHaveBeenCalledTimes(1);
  });
  it("accepts any applicable role that permits the action", async () => {
    const store: AuthorizationStore = {
      resourcePredicate: vi.fn(),
      findRecoverableResourceIds: vi.fn(),
      findResourceRoles: vi
        .fn()
        .mockResolvedValue(new Map([[resource.id, ["viewer", "editor"]]])),
      findWorkspaceRole: vi.fn().mockResolvedValue("owner"),
      hasWorkspaceAccess: vi.fn().mockResolvedValue(true),
      findGrantNarrowing: vi.fn().mockResolvedValue(null),
      listAccessibleWorkspaceIds: vi.fn().mockResolvedValue([]),
    };
    const authorization = new AuthorizationService(store);

    await expect(authorization.can(principal, "edit", resource)).resolves.toBe(
      true,
    );
  });

  it("denies a cross-workspace reference before querying the store", async () => {
    const findResourceRoles = vi.fn();
    const store: AuthorizationStore = {
      resourcePredicate: vi.fn(),
      findRecoverableResourceIds: vi.fn(),
      findResourceRoles,
      findWorkspaceRole: vi.fn(),
      hasWorkspaceAccess: vi.fn(),
      findGrantNarrowing: vi.fn(),
      listAccessibleWorkspaceIds: vi.fn(),
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
      resourcePredicate: vi.fn(),
      findRecoverableResourceIds: vi.fn(),
      findResourceRoles: vi.fn().mockResolvedValue(new Map()),
      findWorkspaceRole: vi.fn().mockResolvedValue(null),
      hasWorkspaceAccess: vi.fn().mockResolvedValue(false),
      findGrantNarrowing: vi.fn().mockResolvedValue(null),
      listAccessibleWorkspaceIds: vi.fn().mockResolvedValue([]),
    };
    const authorization = new AuthorizationService(store);

    await expect(
      authorization.assertCan(principal, "view", resource),
    ).rejects.toEqual(new AuthorizationDeniedError());
  });

  it("allows workspace owners and editors to create root objects", async () => {
    const findWorkspaceRole = vi
      .fn()
      .mockResolvedValueOnce("owner")
      .mockResolvedValueOnce("editor")
      .mockResolvedValueOnce("viewer");
    const store: AuthorizationStore = {
      resourcePredicate: vi.fn(),
      findRecoverableResourceIds: vi.fn(),
      findResourceRoles: vi.fn(),
      findWorkspaceRole,
      hasWorkspaceAccess: vi.fn(),
      findGrantNarrowing: vi.fn(),
      listAccessibleWorkspaceIds: vi.fn(),
    };
    const authorization = new AuthorizationService(store);

    await expect(authorization.canCreateInWorkspace(principal)).resolves.toBe(
      true,
    );
    await expect(authorization.canCreateInWorkspace(principal)).resolves.toBe(
      true,
    );
    await expect(authorization.canCreateInWorkspace(principal)).resolves.toBe(
      false,
    );
  });

  it("returns the complete action set for the strongest applicable role", async () => {
    const store: AuthorizationStore = {
      resourcePredicate: vi.fn(),
      findRecoverableResourceIds: vi.fn(),
      findResourceRoles: vi
        .fn()
        .mockResolvedValue(new Map([[resource.id, ["viewer", "owner"]]])),
      findWorkspaceRole: vi.fn(),
      hasWorkspaceAccess: vi.fn(),
      findGrantNarrowing: vi.fn(),
      listAccessibleWorkspaceIds: vi.fn(),
    };
    const authorization = new AuthorizationService(store);

    await expect(
      authorization.allowedActions(principal, resource),
    ).resolves.toEqual([
      "view",
      "comment",
      "edit",
      "share",
      "delete",
      "recover",
    ]);
  });
});
