import { CloudBaseRpcError } from "@chronelle/db";
import { describe, expect, it, vi } from "vitest";

import { CloudBaseCommandWriteRepository } from "../src/cloudbase-command-write-repository.js";
import { hashCommand } from "../src/command-hash.js";
import { CommandStackConflictError } from "../src/errors.js";

const workspaceId = "00000000-0000-7000-8000-000000000001";
const eventId = "00000000-0000-7000-8000-000000000002";
const taskId = "00000000-0000-7000-8000-000000000003";
const userId = "00000000-0000-7000-8000-000000000005";
const operationId = "00000000-0000-7000-8000-000000000010";
const context = {
  principal: { type: "user" as const, userId, workspaceId },
  requestId: "request-1",
};
const principal = {
  workspace_id: workspaceId,
  user_id: userId,
  request_id: "request-1",
};
const request = {
  operationId,
  expectedStackVersion: 3,
  edits: [
    {
      objectType: "event" as const,
      objectId: eventId,
      patch: {
        expectedVersion: 1,
        displayName: "Renamed",
        startsAt: new Date("2030-01-01T09:00:00.000Z"),
        endsAt: null,
      },
    },
    {
      objectType: "task" as const,
      objectId: taskId,
      patch: { expectedVersion: 4, status: "done" as const },
    },
  ],
};
const receipt = {
  operationId,
  commandId: operationId,
  direction: "execute",
  stackVersion: 4,
  objects: [
    { id: eventId, version: 2 },
    { id: taskId, version: 5 },
  ],
};

describe("CloudBaseCommandWriteRepository", () => {
  it("executes with encoded edits and the service's request hash", async () => {
    const rpc = vi.fn().mockResolvedValue(receipt);
    const repository = new CloudBaseCommandWriteRepository({ rpc });

    const result = await repository.execute(context, request);

    expect(rpc).toHaveBeenCalledWith("chronelle_command_execute", {
      ...principal,
      operation_id: operationId,
      expected_stack_version: 3,
      edits: [
        {
          objectType: "event",
          objectId: eventId,
          patch: {
            expectedVersion: 1,
            displayName: "Renamed",
            startsAt: "2030-01-01T09:00:00.000Z",
            endsAt: null,
          },
        },
        {
          objectType: "task",
          objectId: taskId,
          patch: { expectedVersion: 4, status: "done" },
        },
      ],
      request_hash: hashCommand({ direction: "execute", input: request }),
    });
    expect(result).toEqual(receipt);
  });

  it("transitions with the direction and its own request hash", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ ...receipt, direction: "undo", stackVersion: 5 });
    const repository = new CloudBaseCommandWriteRepository({ rpc });
    const input = {
      operationId: "00000000-0000-7000-8000-000000000011",
      commandId: operationId,
      expectedStackVersion: 4,
    };

    const result = await repository.transition(context, input, "undo");

    expect(rpc).toHaveBeenCalledWith("chronelle_command_transition", {
      ...principal,
      operation_id: input.operationId,
      command_id: operationId,
      expected_stack_version: 4,
      direction: "undo",
      request_hash: hashCommand({ direction: "undo", input }),
    });
    expect(result.direction).toBe("undo");
  });

  it("rejects a malformed receipt", async () => {
    const repository = new CloudBaseCommandWriteRepository({
      rpc: vi.fn().mockResolvedValue({ ...receipt, objects: [] }),
    });
    await expect(repository.execute(context, request)).rejects.toThrow();
  });

  it("maps the stack conflict by the service's message", async () => {
    const repository = new CloudBaseCommandWriteRepository({
      rpc: vi
        .fn()
        .mockRejectedValue(
          new CloudBaseRpcError(
            409,
            "DATABASE_PT409",
            new CommandStackConflictError().message,
          ),
        ),
    });
    await expect(repository.execute(context, request)).rejects.toThrow(
      CommandStackConflictError,
    );
  });
});
