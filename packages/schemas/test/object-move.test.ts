import { describe, expect, it } from "vitest";

import {
  objectMovePreviewQuerySchema,
  objectMovePreviewSchema,
  objectMoveRequestSchema,
  objectMoveSummarySchema,
} from "../src/object-move.js";

const id = "019d6e7d-0000-7000-8000-000000000010";
const space = {
  id,
  displayName: "Our wedding",
  personal: false,
  ownerDisplayName: "Jane",
  role: "owner",
};
const counts = {
  scheduleItems: 1,
  todos: 2,
  subtasks: 1,
  expenses: 0,
  reminders: 0,
  notes: 1,
  files: 1,
  sections: 1,
  pages: 2,
  inTrash: 1,
  shares: 1,
  pendingShares: 1,
};
const empty = { items: [], total: 0 };
const preview = {
  eventId: id,
  from: space,
  to: { ...space, role: "editor" },
  moves: counts,
  droppedLinks: {
    items: [
      {
        relationId: id,
        relationType: "includes",
        scoped: { id, objectType: "event", displayName: "Wedding" },
        other: { id, objectType: "person", displayName: "Ana" },
      },
    ],
    total: 1,
  },
  unassignedTasks: empty,
  labels: { items: [{ name: "Venue", existing: true }], total: 1 },
  peopleKept: empty,
  clearedLinks: 2,
  access: {
    targetMembers: { owner: 1, editor: 1, viewer: 0 },
    keepingShares: empty,
    droppedGrants: empty,
    losingAccess: empty,
    lapsingShares: 0,
  },
  expectedDroppedLinks: 1,
};

describe("object move contracts", () => {
  it("normalizes a move request and rejects unknown or negative fields", () => {
    expect(
      objectMoveRequestSchema.parse({
        workspaceId: id.toUpperCase(),
        expectedDroppedLinks: 3,
        commandId: id.toUpperCase(),
      }),
    ).toEqual({ workspaceId: id, expectedDroppedLinks: 3, commandId: id });
    expect(
      objectMoveRequestSchema.parse({
        workspaceId: id,
        expectedDroppedLinks: 0,
      }),
    ).toEqual({ workspaceId: id, expectedDroppedLinks: 0 });
    for (const request of [
      { workspaceId: id },
      { workspaceId: id, expectedDroppedLinks: -1 },
      { workspaceId: id, expectedDroppedLinks: 1.5 },
      { workspaceId: "home", expectedDroppedLinks: 0 },
      { workspaceId: id, expectedDroppedLinks: 0, permissionScopeId: id },
    ])
      expect(objectMoveRequestSchema.safeParse(request).success).toBe(false);
    expect(
      objectMovePreviewQuerySchema.parse({ to: id.toUpperCase() }),
    ).toEqual({ to: id });
  });

  it("bounds each preview list and keeps its exact total", () => {
    expect(objectMovePreviewSchema.parse(preview)).toEqual(preview);
    const link = preview.droppedLinks.items[0];
    expect(
      objectMovePreviewSchema.safeParse({
        ...preview,
        droppedLinks: { items: Array(101).fill(link), total: 101 },
      }).success,
    ).toBe(false);
    expect(
      objectMovePreviewSchema.safeParse({
        ...preview,
        droppedLinks: { items: Array(100).fill(link), total: 250 },
      }).success,
    ).toBe(true);
  });

  it("describes a move's result with both spaces and its instant", () => {
    const summary = {
      commandId: null,
      from: { id, displayName: "Personal" },
      to: { id, displayName: "Our wedding" },
      moves: counts,
      droppedLinks: 1,
      unassignedTasks: 1,
      clearedLinks: 2,
      labelsJoined: 1,
      labelsCreated: 1,
      grantsDropped: 1,
      peopleKept: 1,
      movedAt: "2030-10-01T09:00:00.000Z",
    };
    expect(objectMoveSummarySchema.parse(summary)).toEqual(summary);
    expect(
      objectMoveSummarySchema.safeParse({ ...summary, movedAt: "later" })
        .success,
    ).toBe(false);
  });
});
