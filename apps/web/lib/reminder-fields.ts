import type { ReminderResponse } from "@chronelle/schemas";
import { type DayKey, parseDayKey } from "./day-placement";
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

/**
 * The instant a quickly added reminder is due: 9:00 local time on the
 * given day, or, with no day, the next 9:00 (today's while it is ahead,
 * otherwise tomorrow's).
 */
export function quickReminderInstant(day: DayKey | null, now: Date): string {
  const at =
    day === null
      ? new Date(now.getFullYear(), now.getMonth(), now.getDate())
      : parseDayKey(day);
  at.setHours(9, 0, 0, 0);
  if (day === null && at <= now) at.setDate(at.getDate() + 1);
  return at.toISOString();
}
