import { AuthorizationDeniedError } from "@livtales/authorization";
import { CloudBaseRpcError } from "@livtales/db";
import { describe, expect, it, vi } from "vitest";

import { CloudBaseEventWriteRepository } from "../src/cloudbase-event-write-repository.js";
import { InvalidObjectStateError, ObjectConflictError } from "../src/errors.js";

const workspaceId = "00000000-0000-7000-8000-000000000001";
const objectId = "00000000-0000-7000-8000-000000000002";
const context = {
  principal: { type: "user" as const, userId: "user-1", workspaceId },
  requestId: "request-1",
};
const rows = {
  object: {
    id: objectId,
    workspace_id: workspaceId,
    object_type: "event",
    display_name: "Launch",
    created_by: "user-1",
    permission_scope_id: objectId,
    created_at: "2030-01-01T00:00:00+00:00",
    updated_at: "2030-01-02T00:00:00.5+00:00",
    version: 2,
    archived_at: null,
    deleted_at: null,
    custom_properties: { theme: "gold" },
    metadata: {},
  },
  event: {
    object_id: objectId,
    workspace_id: workspaceId,
    starts_at: "2030-10-16T18:00:00+00:00",
    ends_at: null,
    starts_on: null,
    ends_on: null,
    timezone: "UTC",
    is_all_day: false,
  },
};

describe("CloudBaseEventWriteRepository", () => {
  it("encodes a create as one function call and decodes the returned rows", async () => {
    const rpc = vi.fn().mockResolvedValue(rows);
    const repository = new CloudBaseEventWriteRepository({ rpc });

    const resource = await repository.create(context, {
      displayName: "Launch",
      startsAt: new Date("2030-10-16T18:00:00.000Z"),
      endsAt: null,
      timezone: "UTC",
      customProperties: { theme: "gold" },
    });

    expect(rpc).toHaveBeenCalledExactlyOnceWith("chronelle_event_create", {
      workspace_id: workspaceId,
      user_id: "user-1",
      request_id: "request-1",
      input: {
        displayName: "Launch",
        startsAt: "2030-10-16T18:00:00.000Z",
        endsAt: null,
        timezone: "UTC",
        customProperties: { theme: "gold" },
      },
    });
    expect(resource).toMatchObject({
      id: objectId,
      version: 2,
      displayName: "Launch",
      startsAt: new Date("2030-10-16T18:00:00.000Z"),
      updatedAt: new Date("2030-01-02T00:00:00.500Z"),
      customProperties: { theme: "gold" },
    });
  });

  it("sends only the changed fields, keeps nulls, and forwards the command", async () => {
    const rpc = vi.fn().mockResolvedValue(rows);
    const repository = new CloudBaseEventWriteRepository({ rpc });
    const command = {
      id: "command-1",
      operationId: "operation-1",
      direction: "undo" as const,
    };

    await repository.update({ ...context, command }, objectId, {
      expectedVersion: 1,
      startsAt: null,
      startsOn: "2030-10-17",
      metadata: undefined,
    });

    expect(rpc).toHaveBeenCalledExactlyOnceWith("chronelle_event_update", {
      workspace_id: workspaceId,
      user_id: "user-1",
      request_id: "request-1",
      object_id: objectId,
      expected_version: 1,
      changes: { startsAt: null, startsOn: "2030-10-17" },
      command,
    });
  });

  it.each([
    ["DATABASE_PT403", AuthorizationDeniedError],
    ["DATABASE_PT409", ObjectConflictError],
    ["PT422", InvalidObjectStateError],
  ])("maps a %s rejection to the service error", async (code, expected) => {
    const rpc = vi
      .fn()
      .mockRejectedValue(
        new CloudBaseRpcError(400, code, "endsAt requires startsAt."),
      );
    const repository = new CloudBaseEventWriteRepository({ rpc });

    const error = await repository
      .update(context, objectId, { expectedVersion: 1 })
      .then(() => {
        throw new Error("expected a rejection");
      })
      .catch((failure: Error) => failure);
    expect(error).toBeInstanceOf(expected);
    if (expected === InvalidObjectStateError)
      expect(error.message).toBe("endsAt requires startsAt.");
  });

  it("passes through other gateway failures and rejects malformed rows", async () => {
    const gateway = new CloudBaseRpcError(500, "DATABASE_PT500", "baseline");
    const failing = new CloudBaseEventWriteRepository({
      rpc: vi.fn().mockRejectedValue(gateway),
    });
    await expect(
      failing.update(context, objectId, { expectedVersion: 1 }),
    ).rejects.toBe(gateway);

    const malformed = new CloudBaseEventWriteRepository({
      rpc: vi.fn().mockResolvedValue({ object: rows.object }),
    });
    await expect(
      malformed.create(context, { displayName: "x" }),
    ).rejects.toThrow("invalid event");
  });
});
