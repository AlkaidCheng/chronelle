"use client";

import {
  QuickAddRow,
  type QuickAddSlots,
} from "../../components/quick-add-row";
import { type DayKey, instantDay } from "../../lib/day-placement";
import { useCreateReminder } from "../../lib/queries";
import { quickReminderInstant } from "../../lib/reminder-fields";

/**
 * The quick "Add reminder" row of an Event's reminders or of one of its day
 * groups. A reminder needs an instant: one added under a day is due at
 * 9:00 that day, one added to the list at the next 9:00. The list's row
 * shares its slot with the group of the day that next 9:00 falls on, so
 * the field carries over when that group appears.
 */
export function QuickAddReminder({
  day,
  dayLabel,
  eventId,
  slots,
}: {
  readonly day: DayKey | null;
  /** The day group's heading, named in the row's accessible name. */
  readonly dayLabel?: string | undefined;
  readonly eventId: string;
  readonly slots: QuickAddSlots;
}) {
  const create = useCreateReminder(eventId);
  const nextDay = instantDay(quickReminderInstant(day, new Date()));
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
      slot={`day:${nextDay}`}
      slots={slots}
      text="Add reminder"
    />
  );
}
