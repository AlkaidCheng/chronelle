import type { TaskResponse } from "@livtales/schemas";
import { describe, expect, it } from "vitest";

import { sortTasks } from "../lib/task-sort";

function task(id: string, fields: Partial<TaskResponse> = {}): TaskResponse {
  return {
    id,
    objectType: "task",
    displayName: id,
    status: "todo",
    dueOn: null,
    dueAt: null,
    durationMinutes: null,
    repeatRule: null,
    repeatUntil: null,
    completedAt: null,
    parentTaskId: null,
    assigneeId: null,
    location: null,
    rank: "00000001000",
    labelIds: [],
    permissionScopeId: "scope",
    createdAt: "2030-01-01T00:00:00.000Z",
    updatedAt: "2030-01-01T00:00:00.000Z",
    version: 1,
    ...fields,
  } as TaskResponse;
}

describe("task sort", () => {
  const tasks = [
    task("b", {
      displayName: "Pack",
      rank: "00000002000",
      dueAt: "2030-03-05T09:30:00.000Z",
      updatedAt: "2030-01-03T00:00:00.000Z",
    }),
    task("a", {
      displayName: "book the room",
      rank: "00000001500.5",
      dueOn: "2030-03-05",
      updatedAt: "2030-01-02T00:00:00.000Z",
    }),
    task("c", {
      displayName: "Call",
      rank: "00000001000",
      updatedAt: "2030-01-04T00:00:00.000Z",
    }),
  ];
  const names = (sorted: readonly TaskResponse[]) =>
    sorted.map((item) => item.id);

  it("orders by rank as text, so a fraction sits between its neighbours", () => {
    expect(names(sortTasks(tasks, "manual"))).toEqual(["c", "a", "b"]);
  });

  it("orders by due with a date-only due first in its day and no due last", () => {
    expect(names(sortTasks(tasks, "due"))).toEqual(["a", "b", "c"]);
  });

  it("orders by name regardless of case and by the latest update first", () => {
    expect(names(sortTasks(tasks, "name"))).toEqual(["a", "c", "b"]);
    expect(names(sortTasks(tasks, "updated"))).toEqual(["c", "b", "a"]);
  });

  it("leaves the given array alone", () => {
    const before = names(tasks);
    sortTasks(tasks, "name");
    expect(names(tasks)).toEqual(before);
  });
});
