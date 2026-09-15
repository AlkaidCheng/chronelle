import type {
  TaskParent,
  TaskProgress,
  TaskResponse,
} from "@chronelle/schemas";

/**
 * Subtask progress and parent names derived from one loaded set of tasks,
 * for containers that hold every task of their scope (an Event's To-dos).
 * Paged containers take the same maps from the server instead.
 */
export function deriveTaskTree(tasks: readonly TaskResponse[]): {
  readonly progress: Readonly<Record<string, TaskProgress>>;
  readonly parents: Readonly<Record<string, TaskParent>>;
} {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const progress: Record<string, TaskProgress> = {};
  const parents: Record<string, TaskParent> = {};
  for (const task of tasks) {
    if (task.parentTaskId === null) continue;
    const current = progress[task.parentTaskId] ?? { done: 0, total: 0 };
    progress[task.parentTaskId] = {
      done: current.done + (task.status === "done" ? 1 : 0),
      total: current.total + 1,
    };
    const parent = byId.get(task.parentTaskId);
    if (parent !== undefined)
      parents[task.id] = { taskId: parent.id, displayName: parent.displayName };
  }
  return { progress, parents };
}

/**
 * The tasks in reading order for a list: each parent followed by the
 * subtasks of it that are present, then subtasks whose parent is absent,
 * keeping the given order among peers.
 */
export function nestTasks(tasks: readonly TaskResponse[]): TaskResponse[] {
  const present = new Set(tasks.map((task) => task.id));
  const children = new Map<string, TaskResponse[]>();
  for (const task of tasks)
    if (task.parentTaskId !== null && present.has(task.parentTaskId))
      children.set(task.parentTaskId, [
        ...(children.get(task.parentTaskId) ?? []),
        task,
      ]);
  const ordered: TaskResponse[] = [];
  for (const task of tasks) {
    if (task.parentTaskId !== null && present.has(task.parentTaskId)) continue;
    ordered.push(task, ...(children.get(task.id) ?? []));
  }
  return ordered;
}
