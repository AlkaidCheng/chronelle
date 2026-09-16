"use client";

import { QuickAddRow } from "../../components/quick-add-row";
import type { DayKey } from "../../lib/day-placement";
import { useCreateReminder } from "../../lib/queries";
import { quickReminderInstant } from "../../lib/reminder-fields";

/**
 * The quick "Add reminder" row of an Event's reminders or of one of its day
 * groups. A reminder needs an instant: one added under a day is due at
 * 9:00 that day, one added to the list at the next 9:00.
 */
export function QuickAddReminder({
  day,
  dayLabel,
  eventId,
}: {
  readonly day: DayKey | null;
  /** The day group's heading, named in the row's accessible name. */
  readonly dayLabel?: string | undefined;
  readonly eventId: string;
}) {
  const create = useCreateReminder(eventId);
  return (
    <QuickAddRow
      label={
        dayLabel === undefined
          ? "Add a reminder to the list"
          : `Add a reminder for ${dayLabel}`
      }
      name="New reminder"
      onAdd={(displayName) =>
        create.mutateAsync({
          displayName,
          remindAt: quickReminderInstant(day, new Date()),
        })
      }
      placeholder="Reminder name"
      text="Add reminder"
    />
  );
}
