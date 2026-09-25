"use client";

import type { TimelineResponse } from "@livtales/schemas";
import type { UseQueryResult } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { ErrorNotice, LoadingState } from "../../components/feedback";
import type { ComposerSlots } from "../../lib/composer-slots";
import type { EventFields } from "../../lib/editor-draft-store";
import type { ExpenseFields } from "../../lib/expense-fields";
import {
  useEventWorkspaceQueries,
  useExpenseEditorQueries,
  useReminderEditorQueries,
  useTaskEditorQueries,
} from "../../lib/queries";
import { recordComposerKey } from "../../lib/record-composers";
import type { ReminderFields } from "../../lib/reminder-fields";
import type { TaskFields } from "../../lib/task-fields";
import { TaskComposer } from "../tasks/task-composer";
import { ExpenseComposer } from "./expense-composer";
import { ReminderComposer } from "./reminder-composer";
import { ScheduleComposer } from "./schedule-composer";

export type TimelineEntry = TimelineResponse["items"][number];

/** The full editor a Timeline entry's composer hands over to, with its fields. */
export type TimelineMore =
  | {
      readonly kind: "task";
      readonly id: string;
      readonly fields: Partial<TaskFields>;
    }
  | {
      readonly kind: "event";
      readonly id: string;
      readonly fields: EventFields;
    }
  | {
      readonly kind: "reminder";
      readonly id: string;
      readonly fields: ReminderFields;
    }
  | {
      readonly kind: "expense";
      readonly id: string;
      readonly fields: ExpenseFields;
    };

interface EntryProps {
  readonly entry: TimelineEntry;
  readonly eventId: string;
  readonly onMore: (more: TimelineMore) => void;
  readonly onRefresh: () => Promise<unknown>;
  readonly slots: ComposerSlots;
}

/** The entry's record once read, or what stands in its place meanwhile. */
function loaded<Resource>(
  query: UseQueryResult<Resource>,
  render: (resource: Resource) => ReactNode,
): ReactNode {
  if (query.data !== undefined) return render(query.data);
  if (query.isError) return <ErrorNotice error={query.error} />;
  return <LoadingState />;
}

function TaskEntry({ entry, eventId, onMore, onRefresh, slots }: EntryProps) {
  const { task } = useTaskEditorQueries(entry.canonicalObjectId);
  return loaded(task, (resource) => (
    <TaskComposer
      draftId={resource.id}
      eventId={eventId}
      onMore={(fields) => onMore({ kind: "task", id: resource.id, fields })}
      onRefresh={onRefresh}
      slotKey={recordComposerKey("task", resource.id)}
      slots={slots}
      task={resource}
    />
  ));
}

function ScheduleEntry({
  entry,
  eventId,
  onMore,
  onRefresh,
  slots,
}: EntryProps) {
  const { event } = useEventWorkspaceQueries(
    entry.canonicalObjectId,
    null,
    "always",
  );
  return loaded(event, (resource) => (
    <ScheduleComposer
      eventId={eventId}
      item={resource}
      onMore={(fields) => onMore({ kind: "event", id: resource.id, fields })}
      onRefresh={onRefresh}
      slotKey={recordComposerKey("event", resource.id)}
      slots={slots}
    />
  ));
}

function ReminderEntry({
  entry,
  eventId,
  onMore,
  onRefresh,
  slots,
}: EntryProps) {
  const { reminder } = useReminderEditorQueries(entry.canonicalObjectId);
  return loaded(reminder, (resource) => (
    <ReminderComposer
      eventId={eventId}
      onMore={(fields) => onMore({ kind: "reminder", id: resource.id, fields })}
      onRefresh={onRefresh}
      reminder={resource}
      slotKey={recordComposerKey("reminder", resource.id)}
      slots={slots}
    />
  ));
}

function ExpenseEntry({
  entry,
  eventId,
  onMore,
  onRefresh,
  slots,
}: EntryProps) {
  const { expense } = useExpenseEditorQueries(entry.canonicalObjectId);
  return loaded(expense, (resource) => (
    <ExpenseComposer
      eventId={eventId}
      expense={resource}
      onMore={(fields) => onMore({ kind: "expense", id: resource.id, fields })}
      onRefresh={onRefresh}
      slotKey={recordComposerKey("expense", resource.id)}
      slots={slots}
    />
  ));
}

/**
 * A Timeline entry opened in place: the entry names its record and the
 * Timeline holds only the name and the moment, so the record is read and
 * its kind's composer takes the entry's place.
 */
export function TimelineEntryComposer(props: EntryProps) {
  switch (props.entry.objectType) {
    case "task":
      return <TaskEntry {...props} />;
    case "event":
      return <ScheduleEntry {...props} />;
    case "reminder":
      return <ReminderEntry {...props} />;
    case "expense":
      return <ExpenseEntry {...props} />;
  }
}
