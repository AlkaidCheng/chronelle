import type { TaskResponse } from "@chronelle/schemas";
import { describe, expect, it } from "vitest";

import { deriveTaskTree, nestTasks } from "../lib/task-tree";

let counter = 0;
function task(
  name: string,
  parentTaskId: string | null = null,
  status: TaskResponse["status"] = "todo",
): TaskResponse {
  counter += 1;
  return {
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`,
    displayName: name,
    parentTaskId,
    status,
    dueOn: null,
    dueAt: null,
    version: 1,
  } as TaskResponse;
}

describe("task tree", () => {
  it("counts subtasks per parent and names present parents", () => {
    const parent = task("Plan");
    const done = task("Book", parent.id, "done");
    const open = task("Pay", parent.id);
    const orphan = task("Lost", "00000000-0000-4000-8000-999999999999");
    expect(deriveTaskTree([parent, done, open, orphan])).toEqual({
      progress: {
        [parent.id]: { done: 1, total: 2 },
        "00000000-0000-4000-8000-999999999999": { done: 0, total: 1 },
      },
      parents: {
        [done.id]: { taskId: parent.id, displayName: "Plan" },
        [open.id]: { taskId: parent.id, displayName: "Plan" },
      },
    });
  });

  it("places subtasks after their parent and leaves orphans in order", () => {
    const first = task("First");
    const parent = task("Plan");
    const orphan = task("Lost", "00000000-0000-4000-8000-999999999999");
    const child = task("Book", parent.id);
    const last = task("Last");
    expect(
      nestTasks([child, first, orphan, parent, last]).map(
        (item) => item.displayName,
      ),
    ).toEqual(["First", "Lost", "Plan", "Book", "Last"]);
  });
});
