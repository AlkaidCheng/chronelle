import type { TaskResponse } from "@livtales/schemas";
import { describe, expect, it } from "vitest";

import type { PlanningProjection } from "../src/features/planning/data";
import { replaceTaskProjection, taskAccessQueryKey } from "../src/tasks/data";

function task(id: string, displayName: string): TaskResponse {
  return {
    archivedAt: null,
    assigneeId: null,
    completedAt: null,
    createdAt: "2030-01-01T00:00:00.000Z",
    createdBy: "019d6e7d-0000-7000-8000-000000000003",
    customProperties: {},
    deletedAt: null,
    description: null,
    displayName,
    dueAt: null,
    dueOn: null,
    durationMinutes: null,
    id,
    labelIds: [],
    location: null,
    metadata: {},
    objectType: "task",
    parentTaskId: null,
    permissionScopeId: "019d6e7d-0000-7000-8000-000000000004",
    rank: "00000001000",
    repeatRule: null,
    repeatUntil: null,
    sectionId: null,
    status: "todo",
    updatedAt: "2030-01-01T00:00:00.000Z",
    version: 1,
    workspaceId: "019d6e7d-0000-7000-8000-000000000002",
  };
}

describe("Mini Program Task cache data", () => {
  it("partitions access by workspace and canonical resource", () => {
    expect(taskAccessQueryKey("workspace", "task")).toEqual([
      "wechat-task-access",
      "workspace",
      "task",
    ]);
  });

  it("replaces only the matching canonical Task in the To-dos projection", () => {
    const first = task("019d6e7d-0000-7000-8000-000000000001", "First");
    const second = task("019d6e7d-0000-7000-8000-000000000002", "Second");
    const projection: PlanningProjection = {
      kind: "todos",
      value: { items: [first, second], sections: [], sourceEventId: "event" },
    };
    const saved = { ...second, displayName: "Updated", version: 2 };

    const result = replaceTaskProjection(projection, saved);
    expect(result?.kind).toBe("todos");
    if (result?.kind !== "todos") return;
    expect(result.value.items).toEqual([first, saved]);
    expect(result.value.items[0]).toBe(first);
  });

  it("leaves unrelated and absent projections untouched", () => {
    const saved = task("019d6e7d-0000-7000-8000-000000000001", "Saved");
    const calendar: PlanningProjection = {
      kind: "calendar",
      value: { items: [], sourceEventId: "event" },
    };
    const todos: PlanningProjection = {
      kind: "todos",
      value: { items: [], sections: [], sourceEventId: "event" },
    };
    expect(replaceTaskProjection(calendar, saved)).toBe(calendar);
    expect(replaceTaskProjection(todos, saved)).toBe(todos);
    expect(replaceTaskProjection(undefined, saved)).toBeUndefined();
  });
});
