"use client";

import type { SectionResponse } from "@chronelle/schemas";
import { useTranslations } from "next-intl";
import { useEffect } from "react";

import { PlusIcon } from "../../components/icons";
import { addComposerKey, type ComposerSlots } from "../../lib/composer-slots";
import type { DayKey } from "../../lib/day-placement";
import { useEditorDraftStore } from "../../lib/editor-draft-context";
import { eventCreationDraftKeys } from "../../lib/editor-draft-store";
import type { TaskFields } from "../../lib/task-fields";
import { standaloneTaskDraftId, TaskComposer } from "./task-composer";

// The row that adds a task with no due date is one slot in every view, so
// the composer under an empty by-day view carries over to the No due date
// group.
const undatedSlot = "undated";

/** The slot of an add row: the list, a day group, or a section. */
export const addTaskSlot = (
  dueOn: DayKey | null,
  sectionId: string | null = null,
) =>
  sectionId !== null
    ? `section:${sectionId}`
    : dueOn === null
      ? undatedSlot
      : `day:${dueOn}`;

/**
 * The draft key of an add row's composer, apart from the Event's task
 * dialog's (which keeps a save in flight or one whose answer was lost for
 * its own recovery); a day group's or a section's row keeps its own.
 */
export function addTaskDraftId(
  eventId: string | undefined,
  dueOn: DayKey | null,
  sectionId: string | null = null,
): string {
  const base = `${
    eventId === undefined
      ? standaloneTaskDraftId
      : eventCreationDraftKeys(eventId).task
  }:composer`;
  if (sectionId !== null) return `${base}:section:${sectionId}`;
  return dueOn === null ? base : `${base}:${dueOn}`;
}

/**
 * The last row of a task list, of one of its day groups, or of a section:
 * a quiet "Add task" line that opens the composer, empty, with the name
 * focused. A task added under a day is due on that day; one added under a
 * section starts in it; one added to the list has neither. The task goes
 * through the same creation request as the dialog's, inside the Event
 * when the list belongs to one.
 */
export function AddTaskRow({
  dayLabel,
  dueOn,
  eventId,
  now,
  onMore,
  onRefresh,
  section = null,
  sections,
  slots,
}: {
  /** The day group's heading, named in the row's accessible name. */
  readonly dayLabel?: string | undefined;
  readonly dueOn: DayKey | null;
  readonly eventId?: string | undefined;
  /** Today, for tests. */
  readonly now?: Date | undefined;
  /** Opens the full editor for a new task with the composer's fields. */
  readonly onMore: (fields: Partial<TaskFields>) => void;
  readonly onRefresh: () => Promise<unknown>;
  /** The section of the Event's To-dos the row adds to; null for none. */
  readonly section?: SectionResponse | null | undefined;
  /** The sections of the Event's To-dos, when the list has them. */
  readonly sections?: readonly SectionResponse[] | undefined;
  readonly slots: ComposerSlots;
}) {
  const t = useTranslations("quickAdd");
  const sectionId = section?.id ?? null;
  const slotKey = addComposerKey(addTaskSlot(dueOn, sectionId));
  const draftId = addTaskDraftId(eventId, dueOn, sectionId);
  // A composer left open in this tab, its draft kept, opens again when the
  // row comes back, with nothing else open in the list; a draft whose
  // save is still in flight is left to settle.
  const store = useEditorDraftStore();
  const { open, request } = slots;
  useEffect(() => {
    const kept = store.get(draftId);
    if (open === null && kept !== undefined && !kept.pending) request(slotKey);
  }, [draftId, open, request, slotKey, store]);
  if (open === slotKey)
    return (
      <TaskComposer
        draftId={draftId}
        dueOn={dueOn}
        eventId={eventId}
        onMore={onMore}
        onRefresh={onRefresh}
        sectionId={sections === undefined ? undefined : sectionId}
        slotKey={slotKey}
        slots={slots}
        {...(now === undefined ? {} : { now })}
      />
    );
  return (
    <button
      aria-label={
        section !== null
          ? t("taskToSection", { section: section.name })
          : dayLabel === undefined
            ? t("taskToList")
            : dueOn === null
              ? t("taskWith", { day: dayLabel })
              : t("taskFor", { day: dayLabel })
      }
      className="quick-add"
      onClick={() => slots.request(slotKey)}
      type="button"
    >
      <PlusIcon />
      <span>{t("addTask")}</span>
    </button>
  );
}
