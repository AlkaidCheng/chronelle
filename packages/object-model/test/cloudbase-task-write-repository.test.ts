import { describe, expect, it, vi } from "vitest";

import { CloudBaseTaskWriteRepository } from "../src/cloudbase-task-write-repository.js";

// Encoding, error mapping, and the command envelope are shared with the Event
// adapter and covered there; this test pins the Task function names and rows.

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
    object_type: "task",
    display_name: "Book the caterer",
    created_by: "user-1",
    permission_scope_id: objectId,
    created_at: "2030-01-01T00:00:00+00:00",
    updated_at: "2030-01-02T00:00:00+00:00",
    version: 2,
    archived_at: null,
    deleted_at: null,
    custom_properties: {},
    metadata: {},
  },
  task: {
    object_id: objectId,
    workspace_id: workspaceId,
    status: "done",
    due_at: "2030-10-01T09:00:00+00:00",
    rank: "00000001000",
    completed_at: "2030-09-28T15:30:00+00:00",
  },
};

describe("CloudBaseTaskWriteRepository", () => {
  it("calls the Task functions and decodes the task row", async () => {
    const rpc = vi.fn().mockResolvedValue(rows);
    const repository = new CloudBaseTaskWriteRepository({ rpc });

    const created = await repository.create(context, {
      displayName: "Book the caterer",
      status: "done",
      completedAt: new Date("2030-09-28T15:30:00.000Z"),
    });
    const updated = await repository.update(context, objectId, {
      expectedVersion: 1,
      dueOn: "2030-10-02",
      dueAt: null,
    });

    expect(rpc).toHaveBeenNthCalledWith(1, "chronelle_task_create", {
      workspace_id: workspaceId,
      user_id: "user-1",
      request_id: "request-1",
      input: {
        displayName: "Book the caterer",
        status: "done",
        completedAt: "2030-09-28T15:30:00.000Z",
      },
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "chronelle_task_update", {
      workspace_id: workspaceId,
      user_id: "user-1",
      request_id: "request-1",
      object_id: objectId,
      expected_version: 1,
      changes: { dueOn: "2030-10-02", dueAt: null },
      command: null,
    });
    for (const resource of [created, updated]) {
      expect(resource).toMatchObject({
        id: objectId,
        objectType: "task",
        version: 2,
        status: "done",
        dueOn: null,
        dueAt: new Date("2030-10-01T09:00:00.000Z"),
        completedAt: new Date("2030-09-28T15:30:00.000Z"),
        parentTaskId: null,
        assigneeId: null,
        location: null,
        description: null,
        labelIds: [],
      });
    }
  });

  it("rejects rows without a task record", async () => {
    const repository = new CloudBaseTaskWriteRepository({
      rpc: vi.fn().mockResolvedValue({ object: rows.object, event: {} }),
    });
    await expect(
      repository.create(context, { displayName: "x" }),
    ).rejects.toThrow("invalid task");
  });
});
