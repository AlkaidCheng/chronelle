"use client";

import { QuickAddRow } from "../../components/quick-add-row";
import type { DayKey } from "../../lib/day-placement";
import { useCreateTask } from "../../lib/queries";

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
}: {
  /** The day group's heading, named in the row's accessible name. */
  readonly dayLabel?: string | undefined;
  readonly dueOn: DayKey | null;
  readonly eventId?: string | undefined;
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
      text="Add task"
    />
  );
}
