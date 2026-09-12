import type { TaskResponse } from "@chronelle/schemas";
import { fromDateTimeInput, toDateTimeInput } from "./format";

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
  if (fields.dueAt === toDateTimeInput(source?.dueAt ?? null))
    return { displayName: fields.displayName, dueAt: source?.dueAt ?? null };
  let dueAt: string | null;
  try {
    dueAt = fromDateTimeInput(fields.dueAt);
  } catch {
    throw new Error("Choose a valid due date and time.");
  }
  if (toDateTimeInput(dueAt) !== fields.dueAt)
    throw new Error("This local time is unavailable. Choose another due time.");
  return { displayName: fields.displayName, dueAt };
}
