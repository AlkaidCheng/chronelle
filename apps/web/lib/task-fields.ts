import type { TaskResponse } from "@chronelle/schemas";
import { editedInstant } from "./edited-instant";
import { toDateTimeInput } from "./format";

export function readTaskFields(
  task?: Pick<TaskResponse, "displayName" | "dueAt">,
) {
  return {
    displayName: task?.displayName ?? "",
    dueAt: toDateTimeInput(task?.dueAt ?? null),
  };
}

/** Preserves an unchanged due instant and rejects unavailable local times. */
export function taskFieldsPayload(
  fields: ReturnType<typeof readTaskFields>,
  source?: Pick<TaskResponse, "dueAt">,
) {
  return {
    displayName: fields.displayName,
    dueAt: editedInstant(fields.dueAt, source?.dueAt, "due"),
  };
}
