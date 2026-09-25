import {
  InvalidShareError,
  PrincipalUnavailableError,
} from "@livtales/authorization";
import { CloudBaseRpcError } from "@livtales/db";
import { describe, expect, it, vi } from "vitest";

import { CloudBaseSharingWriteRepository } from "../src/cloudbase-sharing-write-repository.js";
import { InvalidObjectStateError } from "../src/errors.js";

const workspaceId = "00000000-0000-7000-8000-000000000001";
const resourceId = "00000000-0000-7000-8000-000000000002";
const grantId = "00000000-0000-7000-8000-000000000003";
const userId = "00000000-0000-7000-8000-000000000005";
const granteeId = "00000000-0000-7000-8000-000000000006";
const context = {
  principal: { type: "user" as const, userId, workspaceId },
  requestId: "request-1",
};
const grantRow = {
  id: grantId,
  workspace_id: workspaceId,
  resource_id: resourceId,
  principal_type: "user",
  principal_id: granteeId,
  role: "editor",
  granted_by: userId,
  created_at: "2030-08-01T12:00:00+00:00",
  expires_at: null,
  principal: {
    id: granteeId,
    displayName: "Grantee",
    email: "grantee@example.test",
  },
};

describe("CloudBaseSharingWriteRepository", () => {
  it("shares and revokes through the two functions", async () => {
    const rpc = vi.fn().mockResolvedValueOnce(grantRow).mockResolvedValueOnce({
      id: grantId,
      revokedAt: "2030-08-02T12:00:00.000Z",
    });
    const repository = new CloudBaseSharingWriteRepository({ rpc });

    const grant = await repository.share(context, {
      resourceId,
      principalEmail: "grantee@example.test",
      role: "editor",
    });
    const revoked = await repository.revoke(
      context,
      grantId,
      new Date("2030-08-02T12:00:00.000Z"),
    );

    const principal = {
      workspace_id: workspaceId,
      user_id: userId,
      request_id: "request-1",
    };
    expect(rpc).toHaveBeenNthCalledWith(1, "chronelle_resource_share", {
      ...principal,
      resource_id: resourceId,
      principal_email: "grantee@example.test",
      role: "editor",
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "chronelle_resource_share_revoke", {
      ...principal,
      grant_id: grantId,
      revoked_at: "2030-08-02T12:00:00.000Z",
    });
    expect(grant).toEqual({
      id: grantId,
      workspaceId,
      resourceId,
      role: "editor",
      grantedBy: userId,
      createdAt: new Date("2030-08-01T12:00:00.000Z"),
      expiresAt: null,
      scope: null,
      principal: {
        id: granteeId,
        displayName: "Grantee",
        email: "grantee@example.test",
      },
    });
    expect(revoked).toEqual({
      id: grantId,
      revokedAt: new Date("2030-08-02T12:00:00.000Z"),
    });
  });

  it("changes the permission scope through chronelle_object_scope_update", async () => {
    const rpc = vi.fn().mockResolvedValue({
      object: {
        id: resourceId,
        workspace_id: workspaceId,
        object_type: "task",
        display_name: "Child",
        created_by: userId,
        permission_scope_id: resourceId,
        created_at: "2030-01-01T00:00:00+00:00",
        updated_at: "2030-08-01T12:00:00+00:00",
        version: 2,
        archived_at: null,
        deleted_at: null,
        custom_properties: {},
        metadata: {},
      },
      task: {
        object_id: resourceId,
        workspace_id: workspaceId,
        status: "todo",
        due_at: null,
        rank: "00000001000",
        completed_at: null,
      },
    });
    const repository = new CloudBaseSharingWriteRepository({ rpc });
    const resource = await repository.updatePermissionScope(
      context,
      resourceId,
      1,
      resourceId,
      new Date("2030-08-01T12:00:00.000Z"),
    );
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      "chronelle_object_scope_update",
      {
        workspace_id: workspaceId,
        user_id: userId,
        request_id: "request-1",
        object_id: resourceId,
        expected_version: 1,
        permission_scope_id: resourceId,
        updated_at: "2030-08-01T12:00:00.000Z",
      },
    );
    expect(resource).toMatchObject({
      id: resourceId,
      objectType: "task",
      version: 2,
      permissionScopeId: resourceId,
    });
  });

  it.each([
    [
      "DATABASE_PT404",
      "The requested user is unavailable.",
      PrincipalUnavailableError,
    ],
    [
      "DATABASE_PT400",
      "A resource cannot be shared with the acting user.",
      InvalidShareError,
    ],
    [
      "DATABASE_PT422",
      "permissionScopeId must reference a self-scoped Event.",
      InvalidObjectStateError,
    ],
  ])("maps %s to the service error", async (code, message, expected) => {
    const repository = new CloudBaseSharingWriteRepository({
      rpc: vi.fn().mockRejectedValue(new CloudBaseRpcError(400, code, message)),
    });
    const error = await repository
      .share(context, {
        resourceId,
        principalEmail: "x@example.test",
        role: "viewer",
      })
      .then(() => {
        throw new Error("expected a rejection");
      })
      .catch((failure: Error) => failure);
    expect(error).toBeInstanceOf(expected);
    expect(error.message).toBe(message);
  });

  it("rejects a grant row with an unknown role", async () => {
    const repository = new CloudBaseSharingWriteRepository({
      rpc: vi.fn().mockResolvedValue({ ...grantRow, role: "admin" }),
    });
    await expect(
      repository.share(context, {
        resourceId,
        principalEmail: "grantee@example.test",
        role: "viewer",
      }),
    ).rejects.toThrow("invalid grant role");
  });
});
