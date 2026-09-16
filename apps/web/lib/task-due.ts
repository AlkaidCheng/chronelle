import type { TaskResponse } from "@chronelle/schemas";
import { describeRepeatShort } from "./due-choices";
import { formatCalendarDate } from "./event-schedule";
import { formatDateTime, formatDuration, formatTime } from "./format";

/**
 * A task's due as people read it: the date alone, the local date and time
 * with the duration after it, or none, and how it repeats.
 */
export function formatTaskDue(
  task: Pick<
    TaskResponse,
    "dueOn" | "dueAt" | "durationMinutes" | "repeatRule"
  >,
): string {
  const due =
    task.dueOn !== null
      ? formatCalendarDate(task.dueOn)
      : withDuration(formatDateTime(task.dueAt), task);
  const repeat = describeRepeatShort(task.repeatRule);
  return [due, repeat].filter((part) => part !== "").join(" \u00b7 ");
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

/**
 * What a row says under a task's name: its time (with the date when asked
 * for) or, when asked for, its date, and how it repeats; empty when none.
 */
export function formatTaskWhen(
  task: Pick<
    TaskResponse,
    "dueOn" | "dueAt" | "durationMinutes" | "repeatRule"
  >,
  showDate: boolean,
): string {
  const when =
    task.dueAt !== null
      ? formatTaskTime(task, showDate)
      : task.dueOn !== null && showDate
        ? formatCalendarDate(task.dueOn)
        : "";
  const repeat = describeRepeatShort(task.repeatRule);
  return [when, repeat].filter((part) => part !== "").join(" \u00b7 ");
}

function withDuration(
  text: string,
  task: Pick<TaskResponse, "durationMinutes">,
): string {
  return task.durationMinutes === null
    ? text
    : `${text}, ${formatDuration(task.durationMinutes)}`;
}
