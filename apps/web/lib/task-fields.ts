import type { TaskResponse } from "@chronelle/schemas";
import { editedInstant } from "./edited-instant";
import { toDateTimeInput } from "./format";

/**
 * The editor's due fields: a calendar date and an optional local time. A
 * task due on a date fills only the date; a task due at an instant fills
 * both from the local rendering of that instant.
 */
export function readTaskFields(
  task?: Pick<TaskResponse, "displayName" | "dueOn" | "dueAt" | "labelIds">,
) {
  const [dueDate = "", dueTime = ""] =
    task?.dueOn !== null && task?.dueOn !== undefined
      ? [task.dueOn, ""]
      : toDateTimeInput(task?.dueAt ?? null).split("T");
  return {
    displayName: task?.displayName ?? "",
    dueDate,
    dueTime,
    // Label ids as one sorted string, so an unchanged set compares equal.
    labels: joinLabelIds(task?.labelIds ?? []),
  };
}

export function joinLabelIds(labelIds: readonly string[]): string {
  return [...new Set(labelIds)].sort().join(",");
}

export function splitLabelIds(labels: string): string[] {
  return labels === "" ? [] : labels.split(",");
}

/**
 * A date alone is a date-only due; a date with a time is a due instant,
 * preserved unchanged when the local rendering did not change. A time
 * without a date is refused.
 */
export function taskFieldsPayload(
  fields: ReturnType<typeof readTaskFields>,
  source?: Pick<TaskResponse, "dueAt">,
) {
  const labelIds = splitLabelIds(fields.labels);
  if (fields.dueDate === "") {
    if (fields.dueTime !== "")
      throw new Error("Choose a due date for the due time.");
    return {
      displayName: fields.displayName,
      dueOn: null,
      dueAt: null,
      labelIds,
    };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fields.dueDate))
    throw new Error("Choose a valid due date.");
  if (fields.dueTime === "")
    return {
      displayName: fields.displayName,
      dueOn: fields.dueDate,
      dueAt: null,
      labelIds,
    };
  return {
    displayName: fields.displayName,
    dueOn: null,
    dueAt: editedInstant(
      `${fields.dueDate}T${fields.dueTime}`,
      source?.dueAt,
      "due",
    ),
    labelIds,
  };
}
