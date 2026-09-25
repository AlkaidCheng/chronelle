import { AuthorizationDeniedError } from "@livtales/authorization";
import { CloudBaseRpcError } from "@livtales/db";
import { describe, expect, it, vi } from "vitest";

import { CloudBaseEventContextWriteRepository } from "../src/cloudbase-event-context-write-repository.js";
import {
  CommandConflictError,
  InvalidObjectStateError,
  InvalidRelationError,
  ObjectConflictError,
  RelationConflictError,
} from "../src/errors.js";
import { eventContextRequestHash } from "../src/event-context-service.js";

const workspaceId = "00000000-0000-7000-8000-000000000001";
const eventId = "00000000-0000-7000-8000-000000000002";
const childId = "00000000-0000-7000-8000-000000000003";
const relationId = "00000000-0000-7000-8000-000000000004";
const commandId = "00000000-0000-7000-8000-000000000005";
const userId = "00000000-0000-7000-8000-000000000006";
const context = {
  principal: { type: "user" as const, userId, workspaceId },
  requestId: "request-1",
};
const request = {
  commandId,
  resource: {
    objectType: "task" as const,
    displayName: "Print badges",
    dueAt: new Date("2030-10-10T09:00:00.000Z"),
    status: "todo" as const,
  },
  relationMetadata: { order: 1 },
};
const snapshot = {
  id: childId,
  workspaceId,
  objectType: "task",
  displayName: "Print badges",
  createdBy: userId,
  permissionScopeId: eventId,
  createdAt: "2030-01-01T00:00:00.000Z",
  updatedAt: "2030-01-01T00:00:00.000Z",
  version: 1,
  archivedAt: null,
  deletedAt: null,
  customProperties: {},
  metadata: {},
  status: "todo",
  dueAt: "2030-10-10T09:00:00.000Z",
  completedAt: null,
};

describe("CloudBaseEventContextWriteRepository", () => {
  it("sends one call with the service's request hash and parses the result", async () => {
    const rpc = vi.fn().mockResolvedValue({ resource: snapshot, relationId });
    const repository = new CloudBaseEventContextWriteRepository({ rpc });

    const result = await repository.create(context, eventId, request);

    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      "chronelle_event_context_create",
      {
        workspace_id: workspaceId,
        user_id: userId,
        request_id: "request-1",
        event_id: eventId,
        command_id: commandId,
        request_hash: eventContextRequestHash(eventId, request),
        resource: {
          objectType: "task",
          displayName: "Print badges",
          dueAt: "2030-10-10T09:00:00.000Z",
          status: "todo",
        },
        relation_metadata: { order: 1 },
      },
    );
    expect(result.relationId).toBe(relationId);
    expect(result.resource).toMatchObject({
      id: childId,
      objectType: "task",
      permissionScopeId: eventId,
    });
  });

  it.each([
    [
      "DATABASE_PT403",
      "The resource is unavailable.",
      AuthorizationDeniedError,
    ],
    [
      "DATABASE_PT400",
      "The relationship is not valid for these object types.",
      InvalidRelationError,
    ],
    [
      "DATABASE_PT409",
      "The command ID was already used with different input.",
      CommandConflictError,
    ],
    [
      "DATABASE_PT409",
      "The active relationship already exists.",
      RelationConflictError,
    ],
    [
      "DATABASE_PT409",
      "The object changed since it was read.",
      ObjectConflictError,
    ],
    [
      "DATABASE_PT422",
      "The context must be a self-scoped Event.",
      InvalidObjectStateError,
    ],
  ])("maps %s (%s) to the service error", async (code, message, expected) => {
    const repository = new CloudBaseEventContextWriteRepository({
      rpc: vi.fn().mockRejectedValue(new CloudBaseRpcError(400, code, message)),
    });
    const error = await repository
      .create(context, eventId, request)
      .then(() => {
        throw new Error("expected a rejection");
      })
      .catch((failure: Error) => failure);
    expect(error).toBeInstanceOf(expected);
  });

  it("rejects a malformed result", async () => {
    const repository = new CloudBaseEventContextWriteRepository({
      rpc: vi.fn().mockResolvedValue({ resource: { id: childId } }),
    });
    await expect(
      repository.create(context, eventId, request),
    ).rejects.toThrow();
  });
});
