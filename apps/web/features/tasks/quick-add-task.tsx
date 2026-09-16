"use client";

import {
  QuickAddRow,
  type QuickAddSlots,
} from "../../components/quick-add-row";
import type { DayKey } from "../../lib/day-placement";
import { useCreateTask } from "../../lib/queries";

// The row that adds a task with no due date is one slot in every view, so
// the field under an empty by-day view carries over to the No due date group.
const undatedTaskSlot = "undated";

/**
 * The quick "Add task" row of a task list or of one of its day groups. A
 * task added under a day is due on that day; one added to the list has no
 * due date. The task goes through the same creation request as the
 * editor's, inside the Event when the list belongs to one.
 */
export function QuickAddTask({
  dayLabel,
  dueOn,
  eventId,
  slots,
}: {
  /** The day group's heading, named in the row's accessible name. */
  readonly dayLabel?: string | undefined;
  readonly dueOn: DayKey | null;
  readonly eventId?: string | undefined;
  readonly slots: QuickAddSlots;
}) {
  const create = useCreateTask(eventId);
  return (
    <QuickAddRow
      label={
        dayLabel === undefined
          ? "Add a task to the list"
          : dueOn === null
            ? `Add a task with ${dayLabel}`
            : `Add a task for ${dayLabel}`
      }
      name="New task"
      onAdd={(displayName) => create.mutateAsync({ displayName, dueOn })}
      placeholder="Task name"
      slot={dueOn === null ? undatedTaskSlot : `day:${dueOn}`}
      slots={slots}
      text="Add task"
    />
  );
}
