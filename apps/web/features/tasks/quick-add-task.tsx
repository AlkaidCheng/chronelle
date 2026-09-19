"use client";

import { useTranslations } from "next-intl";
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
  onDetails,
  sectionId = null,
  slots,
}: {
  /** The day group's heading, named in the row's accessible name. */
  readonly dayLabel?: string | undefined;
  readonly dueOn: DayKey | null;
  readonly eventId?: string | undefined;
  /** Opens the full editor with the typed name, the row's day, and its section. */
  readonly onDetails?:
    | ((
        displayName: string,
        dueOn: DayKey | null,
        sectionId: string | null,
      ) => void)
    | undefined;
  /** The section of the Event's To-dos the row adds to; null for none. */
  readonly sectionId?: string | null | undefined;
  readonly slots: QuickAddSlots;
}) {
  const t = useTranslations("quickAdd");
  const create = useCreateTask(eventId);
  return (
    <QuickAddRow
      details={
        onDetails === undefined
          ? undefined
          : {
              label: t("taskDetails"),
              open: (displayName) => onDetails(displayName, dueOn, sectionId),
            }
      }
      label={
        dayLabel === undefined
          ? t("taskToList")
          : dueOn === null
            ? t("taskWith", { day: dayLabel })
            : t("taskFor", { day: dayLabel })
      }
      name={t("newTask")}
      onAdd={(displayName) =>
        create.mutateAsync({
          displayName,
          dueOn,
          ...(sectionId === null ? {} : { sectionId }),
        })
      }
      placeholder={t("taskName")}
      slot={
        sectionId !== null
          ? `section:${sectionId}`
          : dueOn === null
            ? undatedTaskSlot
            : `day:${dueOn}`
      }
      slots={slots}
      text={t("addTask")}
    />
  );
}
