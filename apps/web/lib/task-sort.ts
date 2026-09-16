import type { TaskListQuery, TaskResponse } from "@chronelle/schemas";

import { taskDay } from "./day-placement";

/** The orders a task collection offers, as `GET /api/tasks` names them. */
export type TaskSort = NonNullable<TaskListQuery["sort"]>;

export const taskSorts: readonly {
  readonly value: TaskSort;
  readonly label: string;
}[] = [
  { value: "manual", label: "Manual" },
  { value: "due", label: "By due" },
  { value: "name", label: "By name" },
  { value: "updated", label: "By updated" },
];

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** A date-only due leads its day, a timed due follows in time order, no due comes last. */
function dueKey(task: TaskResponse): string {
  const day = taskDay(task);
  if (day === null) return "~";
  return task.dueOn === null ? `${day}${task.dueAt ?? ""}` : day;
}

/** The comparison behind one sort, ties broken by id so the order is stable. */
export function compareTasks(
  sort: TaskSort,
): (a: TaskResponse, b: TaskResponse) => number {
  switch (sort) {
    case "manual":
      return (a, b) => compareText(a.rank, b.rank) || compareText(a.id, b.id);
    case "name":
      return (a, b) =>
        a.displayName.localeCompare(b.displayName, undefined, {
          sensitivity: "base",
        }) || compareText(a.id, b.id);
    case "updated":
      return (a, b) =>
        compareText(b.updatedAt, a.updatedAt) || compareText(a.id, b.id);
    case "due":
      return (a, b) =>
        compareText(dueKey(a), dueKey(b)) || compareText(a.id, b.id);
  }
}

/** The tasks in the chosen order, as a new array. */
export function sortTasks(
  tasks: readonly TaskResponse[],
  sort: TaskSort,
): TaskResponse[] {
  return [...tasks].sort(compareTasks(sort));
}
