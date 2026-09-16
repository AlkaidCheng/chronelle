import type { TaskResponse } from "@chronelle/schemas";
import { formatCalendarDate } from "./event-schedule";
import { formatDateTime, formatDuration, formatTime } from "./format";

/**
 * A task's due as people read it: the date alone, the local date and time
 * with the duration after it, or none.
 */
export function formatTaskDue(
  task: Pick<TaskResponse, "dueOn" | "dueAt" | "durationMinutes">,
): string {
  if (task.dueOn !== null) return formatCalendarDate(task.dueOn);
  return withDuration(formatDateTime(task.dueAt), task);
}

/** A timed task's local time with its duration after it: "9:30 AM, 30 min". */
export function formatTaskTime(
  task: Pick<TaskResponse, "dueAt" | "durationMinutes">,
  showDate: boolean,
): string {
  if (task.dueAt === null) return "";
  return withDuration(
    showDate ? formatDateTime(task.dueAt) : formatTime(task.dueAt),
    task,
  );
}

function withDuration(
  text: string,
  task: Pick<TaskResponse, "durationMinutes">,
): string {
  return task.durationMinutes === null
    ? text
    : `${text}, ${formatDuration(task.durationMinutes)}`;
}
