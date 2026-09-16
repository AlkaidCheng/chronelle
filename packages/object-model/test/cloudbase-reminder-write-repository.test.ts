import { describe, expect, it, vi } from "vitest";

import { CloudBaseReminderWriteRepository } from "../src/cloudbase-reminder-write-repository.js";

// Encoding, error mapping, and the command envelope are shared with the Event
// adapter and covered there; this test pins the Reminder function names and rows.

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
    object_type: "reminder",
    display_name: "Call the caterer",
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
  reminder: {
    object_id: objectId,
    workspace_id: workspaceId,
    remind_at: "2030-10-01T08:00:00+00:00",
    status: "triggered",
    rank: "00000001000",
  },
};

describe("CloudBaseReminderWriteRepository", () => {
  it("calls the Reminder functions and decodes the reminder row", async () => {
    const rpc = vi.fn().mockResolvedValue(rows);
    const repository = new CloudBaseReminderWriteRepository({ rpc });

    const created = await repository.create(context, {
      displayName: "Call the caterer",
      remindAt: new Date("2030-10-01T08:00:00.000Z"),
    });
    const updated = await repository.update(context, objectId, {
      expectedVersion: 1,
      status: "triggered",
    });

    expect(rpc).toHaveBeenNthCalledWith(1, "chronelle_reminder_create", {
      workspace_id: workspaceId,
      user_id: "user-1",
      request_id: "request-1",
      input: {
        displayName: "Call the caterer",
        remindAt: "2030-10-01T08:00:00.000Z",
      },
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "chronelle_reminder_update", {
      workspace_id: workspaceId,
      user_id: "user-1",
      request_id: "request-1",
      object_id: objectId,
      expected_version: 1,
      changes: { status: "triggered" },
      command: null,
    });
    for (const resource of [created, updated]) {
      expect(resource).toMatchObject({
        id: objectId,
        objectType: "reminder",
        version: 2,
        remindAt: new Date("2030-10-01T08:00:00.000Z"),
        status: "triggered",
      });
    }
  });

  it("rejects rows with an unknown status", async () => {
    const repository = new CloudBaseReminderWriteRepository({
      rpc: vi.fn().mockResolvedValue({
        object: rows.object,
        reminder: { ...rows.reminder, status: "snoozed" },
      }),
    });
    await expect(
      repository.update(context, objectId, { expectedVersion: 1 }),
    ).rejects.toThrow("invalid reminder status");
  });
});
