import type { TaskResponse } from "@chronelle/schemas";
import { editedInstant } from "./edited-instant";
import { toDateTimeInput } from "./format";

/**
 * The editor's due fields: a calendar date and an optional local time. A
 * task due on a date fills only the date; a task due at an instant fills
 * both from the local rendering of that instant.
 */
export function readTaskFields(
  task?: Pick<
    TaskResponse,
    | "displayName"
    | "dueOn"
    | "dueAt"
    | "durationMinutes"
    | "assigneeId"
    | "location"
    | "labelIds"
  >,
) {
  const [dueDate = "", dueTime = ""] =
    task?.dueOn !== null && task?.dueOn !== undefined
      ? [task.dueOn, ""]
      : toDateTimeInput(task?.dueAt ?? null).split("T");
  return {
    displayName: task?.displayName ?? "",
    dueDate,
    dueTime,
    // The duration in minutes as text; empty for none.
    duration:
      task?.durationMinutes === null || task?.durationMinutes === undefined
        ? ""
        : String(task.durationMinutes),
    // The assignee's person id; empty for an unassigned task.
    assignee: task?.assigneeId ?? "",
    location: task?.location ?? "",
    // Label ids as one sorted string, so an unchanged set compares equal.
    labels: joinLabelIds(task?.labelIds ?? []),
  };
}

/** The most characters a location may hold once trimmed. */
export const locationLimit = 240;

export function joinLabelIds(labelIds: readonly string[]): string {
  return [...new Set(labelIds)].sort().join(",");
}

export function splitLabelIds(labels: string): string[] {
  return labels === "" ? [] : labels.split(",");
}

/** The most minutes a duration may hold: a whole day. */
export const durationLimit = 1440;

/**
 * A date alone is a date-only due; a date with a time is a due instant,
 * preserved unchanged when the local rendering did not change. A time
 * without a date is refused, as is a duration without a time.
 */
export function taskFieldsPayload(
  fields: ReturnType<typeof readTaskFields>,
  source?: Pick<TaskResponse, "dueAt">,
) {
  const assigneeId = fields.assignee === "" ? null : fields.assignee;
  const location =
    fields.location.trim() === "" ? null : fields.location.trim();
  if (location !== null && location.length > locationLimit)
    throw new Error(`Keep the location to ${locationLimit} characters.`);
  const labelIds = splitLabelIds(fields.labels);
  const durationMinutes =
    fields.duration === "" ? null : Number(fields.duration);
  if (
    durationMinutes !== null &&
    (!Number.isInteger(durationMinutes) ||
      durationMinutes < 1 ||
      durationMinutes > durationLimit)
  )
    throw new Error("Choose a duration of up to a day.");
  if (fields.dueDate === "") {
    if (fields.dueTime !== "")
      throw new Error("Choose a due date for the due time.");
    if (durationMinutes !== null)
      throw new Error("Choose a due time for the duration.");
    return {
      displayName: fields.displayName,
      dueOn: null,
      dueAt: null,
      durationMinutes: null,
      assigneeId,
      location,
      labelIds,
    };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fields.dueDate))
    throw new Error("Choose a valid due date.");
  if (fields.dueTime === "") {
    if (durationMinutes !== null)
      throw new Error("Choose a due time for the duration.");
    return {
      displayName: fields.displayName,
      dueOn: fields.dueDate,
      dueAt: null,
      durationMinutes: null,
      assigneeId,
      location,
      labelIds,
    };
  }
  return {
    displayName: fields.displayName,
    dueOn: null,
    dueAt: editedInstant(
      `${fields.dueDate}T${fields.dueTime}`,
      source?.dueAt,
      "due",
    ),
    durationMinutes,
    assigneeId,
    location,
    labelIds,
  };
}
