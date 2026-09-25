import type {
  EventResponse,
  ExpenseResponse,
  NoteListItem,
  ReminderResponse,
  TaskResponse,
  TimelineResponse,
} from "@livtales/schemas";

import { shownTimeZone } from "../../i18n/active-preferences";
import type { DayKey } from "../day-placement";
import type { DaySheet } from "../day-sheet";

/** The columns of an export sheet, by key; the labels are the catalog's. */
export type ExportColumn =
  | "name"
  | "status"
  | "dueDate"
  | "dueTime"
  | "durationMinutes"
  | "repeat"
  | "repeatUntil"
  | "assignee"
  | "labels"
  | "location"
  | "description"
  | "event"
  | "startDate"
  | "startTime"
  | "endDate"
  | "endTime"
  | "allDay"
  | "place"
  | "day"
  | "kind"
  | "when"
  | "amount"
  | "currency"
  | "paidOn"
  | "remindAt"
  | "title"
  | "text"
  | "lastEdited"
  | "editedBy";

/** What a view exports: its columns and one row of cells per record, in the view's order. */
export interface ExportSheet {
  readonly columns: readonly ExportColumn[];
  readonly rows: readonly (readonly string[])[];
}

type TimelineItem = TimelineResponse["items"][number];

/** A named record that may carry a description, once the field exists on its kind. */
type Described = {
  readonly displayName: string;
  readonly description?: string | null | undefined;
};

const descriptionOf = (record: Described): string => record.description ?? "";

/** An instant's calendar date in the shown zone, YYYY-MM-DD. */
export function isoDate(instant: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: shownTimeZone(),
  }).format(new Date(instant));
}

/** An instant's clock time in the shown zone, HH:MM on the 24-hour clock. */
export function isoTime(instant: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: shownTimeZone(),
  }).format(new Date(instant));
}

export interface TaskSheetNames {
  /** The event the tasks belong to, as the last column. */
  readonly event: string;
  readonly labels: ReadonlyMap<string, string> | undefined;
  readonly persons: ReadonlyMap<string, string> | undefined;
}

export function taskSheet(
  tasks: readonly TaskResponse[],
  names: TaskSheetNames,
): ExportSheet {
  return {
    columns: [
      "name",
      "status",
      "dueDate",
      "dueTime",
      "durationMinutes",
      "repeat",
      "repeatUntil",
      "assignee",
      "labels",
      "location",
      "description",
      "event",
    ],
    rows: tasks.map((task) => [
      task.displayName,
      task.status,
      task.dueOn ?? (task.dueAt === null ? "" : isoDate(task.dueAt)),
      task.dueAt === null ? "" : isoTime(task.dueAt),
      task.durationMinutes === null ? "" : String(task.durationMinutes),
      task.repeatRule ?? "",
      task.repeatUntil ?? "",
      task.assigneeId === null
        ? ""
        : (names.persons?.get(task.assigneeId) ?? task.assigneeId),
      task.labelIds.map((id) => names.labels?.get(id) ?? id).join("; "),
      task.location ?? "",
      descriptionOf(task),
      names.event,
    ]),
  };
}

export function scheduleSheet(items: readonly EventResponse[]): ExportSheet {
  return {
    columns: [
      "name",
      "startDate",
      "startTime",
      "endDate",
      "endTime",
      "allDay",
      "place",
      "description",
    ],
    rows: items.map((item) => [
      item.displayName,
      item.startsOn ?? (item.startsAt === null ? "" : isoDate(item.startsAt)),
      item.startsAt === null || item.startsOn !== null
        ? ""
        : isoTime(item.startsAt),
      item.endsOn ?? (item.endsAt === null ? "" : isoDate(item.endsAt)),
      item.endsAt === null || item.endsOn !== null ? "" : isoTime(item.endsAt),
      item.isAllDay ? "yes" : "no",
      item.location ?? "",
      descriptionOf(item),
    ]),
  };
}

/**
 * The itinerary's days as one sheet, each day in the order its page reads:
 * the items running over the day, the timed ones, the tasks due, and the
 * items on the day without a time yet.
 */
export function itinerarySheet(sheets: readonly DaySheet[]): ExportSheet {
  const timeOf = (instant: string | null) =>
    instant === null ? "" : isoTime(instant);
  const scheduleRow = (
    day: DayKey,
    item: EventResponse,
    start: string,
    end: string,
  ) => [day, "event", item.displayName, start, end, item.location ?? ""];
  return {
    columns: ["day", "kind", "name", "startTime", "endTime", "place"],
    rows: sheets.flatMap((sheet) => [
      ...sheet.allDay.map((item) => scheduleRow(sheet.day, item, "", "")),
      ...sheet.rows.flatMap((row) =>
        "item" in row
          ? [
              scheduleRow(
                sheet.day,
                row.item,
                timeOf(row.item.startsAt),
                timeOf(row.item.endsAt),
              ),
            ]
          : [],
      ),
      ...sheet.due.map((task) => [
        sheet.day,
        "task",
        task.displayName,
        timeOf(task.dueAt),
        "",
        task.location ?? "",
      ]),
      ...sheet.untimed.map((item) => scheduleRow(sheet.day, item, "", "")),
    ]),
  };
}

export function timelineSheet(items: readonly TimelineItem[]): ExportSheet {
  return {
    columns: ["kind", "name", "when"],
    rows: items.map((item) => [
      item.objectType,
      item.displayName,
      item.occursOn ??
        (item.occursAt === null
          ? ""
          : `${isoDate(item.occursAt)} ${isoTime(item.occursAt)}`),
    ]),
  };
}

export function expenseSheet(
  expenses: readonly ExpenseResponse[],
): ExportSheet {
  return {
    columns: ["name", "amount", "currency", "paidOn"],
    rows: expenses.map((expense) => [
      expense.displayName,
      expense.amount,
      expense.currency,
      isoDate(expense.occurredAt),
    ]),
  };
}

export function reminderSheet(
  reminders: readonly ReminderResponse[],
): ExportSheet {
  return {
    columns: ["name", "remindAt", "status"],
    rows: reminders.map((reminder) => [
      reminder.displayName,
      `${isoDate(reminder.remindAt)} ${isoTime(reminder.remindAt)}`,
      reminder.status,
    ]),
  };
}

export function noteSheet(notes: readonly NoteListItem[]): ExportSheet {
  return {
    columns: ["title", "text", "lastEdited", "editedBy"],
    rows: notes.map((note) => [
      note.displayName,
      note.body,
      `${isoDate(note.updatedAt)} ${isoTime(note.updatedAt)}`,
      note.editedBy ?? "",
    ]),
  };
}

/**
 * The records a week or month grid shows: those with a day in the shown
 * range, in the list's order, then the undated ones the grid lists apart.
 */
export function shownInPeriod<Item>(
  items: readonly Item[],
  daysOf: (item: Item) => readonly DayKey[],
  range: { readonly from: DayKey; readonly to: DayKey } | null,
): Item[] {
  if (range === null) return [...items];
  const dated = items.filter((item) =>
    daysOf(item).some((day) => day >= range.from && day <= range.to),
  );
  const undated = items.filter((item) => daysOf(item).length === 0);
  return [...dated, ...undated];
}
