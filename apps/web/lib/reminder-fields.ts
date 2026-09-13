import type { ReminderResponse } from "@chronelle/schemas";
import { editedInstant } from "./edited-instant";
import { toDateTimeInput } from "./format";

export function readReminderFields(
  reminder?: Pick<ReminderResponse, "displayName" | "remindAt">,
) {
  return {
    displayName: reminder?.displayName ?? "",
    remindAt: toDateTimeInput(reminder?.remindAt ?? null),
  };
}

export function reminderFieldsPayload(
  fields: ReturnType<typeof readReminderFields>,
  source?: Pick<ReminderResponse, "remindAt">,
) {
  const remindAt = editedInstant(fields.remindAt, source?.remindAt, "reminder");
  if (remindAt === null) throw new Error("Choose a reminder date and time.");
  return { displayName: fields.displayName, remindAt };
}
