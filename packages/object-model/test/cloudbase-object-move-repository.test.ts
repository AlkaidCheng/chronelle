import { AuthorizationDeniedError } from "@livtales/authorization";
import { CloudBaseRpcError } from "@livtales/db";
import { describe, expect, it, vi } from "vitest";

import { CloudBaseObjectMoveRepository } from "../src/cloudbase-object-move-repository.js";
import {
  CommandConflictError,
  InvalidObjectStateError,
} from "../src/errors.js";
import {
  ObjectMoveChangedError,
  ObjectMoveRefusedError,
} from "../src/object-move.js";

const workspaceId = "00000000-0000-7000-8000-000000000001";
const targetId = "00000000-0000-7000-8000-000000000002";
const eventId = "00000000-0000-7000-8000-000000000003";
const userId = "00000000-0000-7000-8000-000000000004";
const commandId = "00000000-0000-7000-8000-000000000005";
const movedAt = new Date("2030-09-01T08:00:00.000Z");
const context = {
  principal: { type: "user" as const, userId, workspaceId },
  requestId: "00000000-0000-7000-8000-000000000006",
};
const counts = {
  scheduleItems: 0,
  todos: 0,
  subtasks: 0,
  expenses: 0,
  reminders: 0,
  notes: 0,
  files: 0,
  sections: 0,
  pages: 0,
  inTrash: 0,
  shares: 0,
  pendingShares: 0,
};
const summary = {
  commandId: null,
  from: { id: workspaceId, displayName: "Home" },
  to: { id: targetId, displayName: "Our wedding" },
  moves: counts,
  droppedLinks: 0,
  unassignedTasks: 0,
  clearedLinks: 0,
  labelsJoined: 0,
  labelsCreated: 0,
  grantsDropped: 0,
  peopleKept: 0,
  movedAt: movedAt.toISOString(),
};
const eventRows = {
  object: {
    id: eventId,
    workspace_id: targetId,
    object_type: "event",
    display_name: "Gala",
    created_by: userId,
    permission_scope_id: eventId,
    created_at: "2030-08-01T12:00:00+00:00",
    updated_at: "2030-08-01T12:00:00+00:00",
    version: 2,
    archived_at: null,
    deleted_at: null,
    deleted_with: null,
    custom_properties: {},
    metadata: {},
  },
  event: {
    object_id: eventId,
    workspace_id: targetId,
    object_type: "event",
    starts_at: null,
    ends_at: null,
    starts_on: "2030-10-16",
    ends_on: null,
    timezone: null,
    is_all_day: true,
    location: null,
    description: null,
  },
};

const rejected = (code: string, message: string) =>
  new CloudBaseRpcError(
    code.startsWith("DATABASE_PT4") ? 400 : 409,
    code,
    message,
  );

describe("CloudBaseObjectMoveRepository", () => {
  it("moves through chronelle_object_move with the clock's instant", async () => {
    const rpc = vi.fn().mockResolvedValue({ event: eventRows, move: summary });
    const repository = new CloudBaseObjectMoveRepository(
      { rpc },
      () => movedAt,
    );
    const moved = await repository.move(context, eventId, {
      workspaceId: targetId,
      expectedDroppedLinks: 3,
    });
    await repository.move(context, eventId, {
      workspaceId: targetId,
      expectedDroppedLinks: 3,
      commandId,
    });
    const common = {
      workspace_id: workspaceId,
      user_id: userId,
      request_id: context.requestId,
      object_id: eventId,
      target_workspace_id: targetId,
      expected_dropped_links: 3,
      moved_at: movedAt.toISOString(),
    };
    expect(rpc.mock.calls).toEqual([
      ["chronelle_object_move", common],
      ["chronelle_object_move", { ...common, command_id: commandId }],
    ]);
    expect(moved.event).toMatchObject({
      id: eventId,
      objectType: "event",
      workspaceId: targetId,
      version: 2,
    });
    expect(moved.move).toEqual(summary);
  });

  it("previews and lists targets through their functions", async () => {
    const rpc = vi.fn().mockResolvedValue({ items: [] });
    const repository = new CloudBaseObjectMoveRepository({ rpc });
    await expect(
      repository.targets(context.principal, eventId),
    ).resolves.toEqual({ items: [] });
    await expect(
      repository.preview(context.principal, eventId, targetId),
    ).rejects.toThrow();
    expect(rpc.mock.calls).toEqual([
      [
        "chronelle_object_move_targets",
        { workspace_id: workspaceId, user_id: userId, object_id: eventId },
      ],
      [
        "chronelle_object_move_preview",
        {
          workspace_id: workspaceId,
          user_id: userId,
          object_id: eventId,
          target_workspace_id: targetId,
        },
      ],
    ]);
  });

  it("tells the move's refusals apart by their messages", async () => {
    const cases: [CloudBaseRpcError, unknown][] = [
      [
        rejected(
          "DATABASE_PT403",
          new ObjectMoveRefusedError("forbidden").message,
        ),
        new ObjectMoveRefusedError("forbidden"),
      ],
      [
        rejected(
          "DATABASE_PT404",
          new ObjectMoveRefusedError("target_unavailable").message,
        ),
        new ObjectMoveRefusedError("target_unavailable"),
      ],
      [
        rejected(
          "DATABASE_PT422",
          new ObjectMoveRefusedError("not_movable").message,
        ),
        new ObjectMoveRefusedError("not_movable"),
      ],
      [
        rejected(
          "DATABASE_PT422",
          new ObjectMoveRefusedError("same_space").message,
        ),
        new ObjectMoveRefusedError("same_space"),
      ],
      [
        rejected("DATABASE_PT409", new ObjectMoveChangedError().message),
        new ObjectMoveChangedError(),
      ],
      [
        rejected("DATABASE_40P01", "deadlock detected"),
        new ObjectMoveChangedError(),
      ],
      [
        rejected("DATABASE_23503", "violates foreign key constraint"),
        new ObjectMoveChangedError(),
      ],
      [
        rejected("DATABASE_PT409", new CommandConflictError().message),
        new CommandConflictError(),
      ],
      [
        rejected("DATABASE_PT403", "The resource is unavailable."),
        new AuthorizationDeniedError(),
      ],
      [
        rejected("DATABASE_PT422", "Some other rule."),
        new InvalidObjectStateError("Some other rule."),
      ],
    ];
    for (const [error, expected] of cases) {
      const repository = new CloudBaseObjectMoveRepository({
        rpc: vi.fn().mockRejectedValue(error),
      });
      const thrown = await repository
        .move(context, eventId, {
          workspaceId: targetId,
          expectedDroppedLinks: 0,
        })
        .catch((failure: unknown) => failure);
      expect(thrown, error.message).toEqual(expected);
      expect((thrown as Error).constructor).toBe(
        (expected as Error).constructor,
      );
    }
  });
});
