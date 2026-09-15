import type { TaskResponse } from "@chronelle/schemas";
import { formatCalendarDate } from "./event-schedule";
import { formatDateTime } from "./format";

/** A task's due as people read it: the date alone, the local date and time, or none. */
export function formatTaskDue(
  task: Pick<TaskResponse, "dueOn" | "dueAt">,
): string {
  if (task.dueOn !== null) return formatCalendarDate(task.dueOn);
  return formatDateTime(task.dueAt);
}
