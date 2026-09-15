import type { TaskResponse } from "@chronelle/schemas";
import { describe, expect, it } from "vitest";

import { groupTasksByDay } from "../lib/task-groups";

// Local times so the grouping does not depend on the test machine's zone.
const now = new Date(2026, 8, 14, 15, 30);
let counter = 0;

function task(
  name: string,
  due: Date | null,
  status: TaskResponse["status"] = "todo",
): TaskResponse {
  counter += 1;
  return {
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`,
    displayName: name,
    dueAt: due === null ? null : due.toISOString(),
    status,
    version: 1,
  } as TaskResponse;
}

describe("groupTasksByDay", () => {
  it("orders overdue, today, tomorrow, later days, and undated tasks", () => {
    const groups = groupTasksByDay(
      [
        task("Later", new Date(2026, 8, 20, 9)),
        task("Undated", null),
        task("Tomorrow", new Date(2026, 8, 15, 8)),
        task("Earlier today", new Date(2026, 8, 14, 9)),
        task("Late today", new Date(2026, 8, 14, 22)),
        task("Missed", new Date(2026, 8, 10, 12)),
      ],
      now,
    );
    expect(
      groups.map((group) => [
        group.label,
        group.tone,
        group.tasks.map((task) => task.displayName),
      ]),
    ).toEqual([
      [["Overdue"], "overdue", ["Missed"]],
      [["Sep 14", "Today", "Monday"], "today", ["Earlier today", "Late today"]],
      [["Sep 15", "Tomorrow", "Tuesday"], "plain", ["Tomorrow"]],
      [["Sep 20", "Sunday"], "plain", ["Later"]],
      [["No due date"], "plain", ["Undated"]],
    ]);
  });

  it("keeps finished and cancelled tasks on their own day instead of Overdue", () => {
    const groups = groupTasksByDay(
      [
        task("Finished", new Date(2026, 8, 10, 12), "done"),
        task("Dropped", new Date(2026, 8, 10, 13), "cancelled"),
        task("Still open", new Date(2026, 8, 10, 14), "in_progress"),
      ],
      now,
    );
    expect(groups.map((group) => group.label)).toEqual([
      ["Overdue"],
      ["Sep 10", "Thursday"],
    ]);
    expect(groups[1]?.tasks.map((task) => task.displayName)).toEqual([
      "Finished",
      "Dropped",
    ]);
  });

  it("treats a task due earlier today as today, not overdue", () => {
    const groups = groupTasksByDay(
      [task("This morning", new Date(2026, 8, 14, 0, 30))],
      now,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.tone).toBe("today");
  });

  it("returns nothing for no tasks", () => {
    expect(groupTasksByDay([], now)).toEqual([]);
  });
});
