"use client";

import type {
  EventResponse,
  ExpenseResponse,
  ReminderResponse,
  TaskResponse,
  TimelineResponse,
} from "@chronelle/schemas";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { type ReactNode, useMemo, useState } from "react";

import { EmptyState, ErrorNotice } from "../../components/feedback";
import { CheckIcon } from "../../components/icons";
import { HistoryButton } from "../history/history-button";
import { LifecycleButton } from "../recovery/lifecycle-provider";
import { formatDateTime, formatMoney, shortId } from "../../lib/format";
import {
  useRefreshEvent,
  useUpdateReminder,
  useUpdateTask,
} from "../../lib/queries";
import {
  ExpenseForm,
  ReminderForm,
  ScheduledEventForm,
  TaskForm,
} from "./resource-forms";

function CanonicalId({ id }: { readonly id: string }) {
  return (
    <span className="canonical-id" title={id}>
      ID {shortId(id)}
    </span>
  );
}

function PanelHeading({
  action,
  description,
  title,
}: {
  readonly action?: ReactNode;
  readonly description: string;
  readonly title: string;
}) {
  return (
    <header className="panel-heading">
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {action}
    </header>
  );
}

type TaskFilter = "all" | "open" | "done";
const taskColumn = createColumnHelper<TaskResponse>();

export function TasksPanel({
  canEdit,
  eventId,
  tasks,
}: {
  readonly canEdit: boolean;
  readonly eventId: string;
  readonly tasks: readonly TaskResponse[];
}) {
  const [filter, setFilter] = useState<TaskFilter>("open");
  const [editingId, setEditingId] = useState<string | null>(null);
  const update = useUpdateTask();
  const refresh = useRefreshEvent(eventId);
  const filteredTasks = useMemo(
    () =>
      tasks.filter((task) => {
        if (filter === "open") {
          return task.status !== "done" && task.status !== "cancelled";
        }
        if (filter === "done") {
          return task.status === "done";
        }
        return true;
      }),
    [filter, tasks],
  );
  const columns = useMemo(
    () => [
      taskColumn.display({
        id: "complete",
        cell: ({ row }) => {
          const task = row.original;
          const isDone = task.status === "done";
          return (
            <button
              aria-label={
                isDone
                  ? `Reopen ${task.displayName}`
                  : `Complete ${task.displayName}`
              }
              className={`task-check${isDone ? " checked" : ""}`}
              disabled={!canEdit || update.isPending}
              onClick={() =>
                update.mutate({
                  id: task.id,
                  input: {
                    completedAt: isDone ? null : new Date().toISOString(),
                    expectedVersion: task.version,
                    status: isDone ? "todo" : "done",
                  },
                })
              }
              type="button"
            >
              {isDone ? <CheckIcon /> : null}
            </button>
          );
        },
      }),
      taskColumn.accessor("displayName", {
        header: "Task",
        cell: ({ row }) => (
          <div className="primary-cell">
            <strong>{row.original.displayName}</strong>
            <CanonicalId id={row.original.id} />
          </div>
        ),
      }),
      taskColumn.accessor("dueAt", {
        header: "Due",
        cell: ({ getValue }) => formatDateTime(getValue()),
      }),
      taskColumn.accessor("status", {
        header: "Status",
        cell: ({ getValue }) => (
          <span className={`status-chip status-${getValue()}`}>
            {getValue().replace("_", " ")}
          </span>
        ),
      }),
      taskColumn.display({
        id: "actions",
        cell: ({ row }) => (
          <div className="row-actions">
            {canEdit ? (
              <button
                className="button button-quiet button-small"
                onClick={() => setEditingId(row.original.id)}
                type="button"
              >
                Edit
              </button>
            ) : null}
            <HistoryButton
              objectId={row.original.id}
              displayName={row.original.displayName}
            />
            {canEdit ? (
              <LifecycleButton target={{ ...row.original, eventId }} />
            ) : null}
          </div>
        ),
      }),
    ],
    [canEdit, update, eventId],
  );
  const table = useReactTable({
    columns,
    data: filteredTasks,
    getCoreRowModel: getCoreRowModel(),
  });
  const editingTask = tasks.find(({ id }) => id === editingId);

  return (
    <section className="planning-panel">
      <PanelHeading
        description="Canonical tasks, sorted by due date and updated wherever they appear."
        title="To-dos"
      />
      {canEdit ? <TaskForm eventId={eventId} /> : null}
      <fieldset className="filter-row">
        <legend>Filter tasks</legend>
        {(["open", "all", "done"] as const).map((value) => (
          <button
            aria-pressed={filter === value}
            className={filter === value ? "active" : ""}
            key={value}
            onClick={() => setFilter(value)}
            type="button"
          >
            {value}
          </button>
        ))}
      </fieldset>
      {update.isError ? (
        <ErrorNotice
          error={update.error}
          onRefresh={() => void refresh().then(() => update.reset())}
        />
      ) : null}
      {filteredTasks.length === 0 ? (
        <EmptyState
          description={
            tasks.length === 0
              ? "Add the first piece of work above."
              : `There are no ${filter} tasks.`
          }
          title={tasks.length === 0 ? "No tasks yet" : "Nothing in this view"}
        />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <th key={header.id}>
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => (
                <tr key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!canEdit || editingTask === undefined ? null : (
        <div className="editor-drawer">
          <div className="drawer-heading">
            <h3>Edit task</h3>
            <CanonicalId id={editingTask.id} />
          </div>
          <TaskForm
            eventId={eventId}
            onCancel={() => setEditingId(null)}
            task={editingTask}
          />
        </div>
      )}
    </section>
  );
}

export function CalendarPanel({
  canEdit,
  eventId,
  items,
}: {
  readonly canEdit: boolean;
  readonly eventId: string;
  readonly items: readonly EventResponse[];
}) {
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const editingEvent = items.find(({ id }) => id === editingId);

  return (
    <section className="planning-panel">
      <PanelHeading
        action={
          canEdit ? (
            <button
              className="button button-secondary"
              onClick={() => setIsAdding((value) => !value)}
              type="button"
            >
              {isAdding ? "Close" : "Add schedule item"}
            </button>
          ) : undefined
        }
        description="Scheduled Events shown directly from their canonical start and end times."
        title="Calendar"
      />
      {isAdding && canEdit ? (
        <div className="editor-drawer open-drawer">
          <ScheduledEventForm
            eventId={eventId}
            onCancel={() => setIsAdding(false)}
          />
        </div>
      ) : null}
      {items.length === 0 ? (
        <EmptyState
          description="Add a timed Event to make the calendar, itinerary, and timeline useful."
          title="Nothing scheduled"
        />
      ) : (
        <div className="calendar-list">
          {items.map((item) => (
            <article className="calendar-item" key={item.id}>
              <time dateTime={item.startsAt ?? undefined}>
                <strong>
                  {item.startsAt === null
                    ? "-"
                    : new Intl.DateTimeFormat(undefined, {
                        day: "2-digit",
                      }).format(new Date(item.startsAt))}
                </strong>
                <span>
                  {item.startsAt === null
                    ? "TBD"
                    : new Intl.DateTimeFormat(undefined, { month: "short" })
                        .format(new Date(item.startsAt))
                        .toUpperCase()}
                </span>
              </time>
              <div>
                <span className="object-label">Scheduled event</span>
                <h3>{item.displayName}</h3>
                <p>
                  {formatDateTime(item.startsAt)}
                  {item.endsAt === null
                    ? ""
                    : ` to ${formatDateTime(item.endsAt)}`}
                </p>
                <CanonicalId id={item.id} />
              </div>
              {canEdit ? (
                <button
                  className="button button-quiet button-small"
                  onClick={() => setEditingId(item.id)}
                  type="button"
                >
                  Edit
                </button>
              ) : null}
              <HistoryButton
                objectId={item.id}
                displayName={item.displayName}
              />
              {canEdit ? (
                <LifecycleButton target={{ ...item, eventId }} />
              ) : null}
            </article>
          ))}
        </div>
      )}
      {!canEdit || editingEvent === undefined ? null : (
        <div className="editor-drawer">
          <div className="drawer-heading">
            <h3>Edit schedule item</h3>
            <CanonicalId id={editingEvent.id} />
          </div>
          <ScheduledEventForm
            event={editingEvent}
            eventId={eventId}
            onCancel={() => setEditingId(null)}
          />
        </div>
      )}
    </section>
  );
}

export function TimelinePanel({
  timeline,
}: {
  readonly timeline: TimelineResponse;
}) {
  return (
    <section className="planning-panel">
      <PanelHeading
        description="One chronological projection across scheduled work, costs, reminders, and Events."
        title="Timeline"
      />
      {timeline.items.length === 0 ? (
        <EmptyState
          description="Dated planning objects will appear here automatically."
          title="No timeline entries"
        />
      ) : (
        <ol className="timeline-list">
          {timeline.items.map((item) => (
            <li key={`${item.objectType}:${item.canonicalObjectId}`}>
              <span className={`timeline-dot object-${item.objectType}`} />
              <time dateTime={item.occursAt}>
                {formatDateTime(item.occursAt)}
              </time>
              <div>
                <span className="object-label">{item.objectType}</span>
                <h3>{item.displayName}</h3>
                <CanonicalId id={item.canonicalObjectId} />
                <HistoryButton
                  objectId={item.canonicalObjectId}
                  displayName={item.displayName}
                />
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function ItineraryPanel({
  items,
}: {
  readonly items: readonly EventResponse[];
}) {
  return (
    <section className="planning-panel">
      <PanelHeading
        description="The same scheduled Events arranged as an ordered run of show."
        title="Itinerary"
      />
      {items.length === 0 ? (
        <EmptyState
          description="Calendar items appear here without creating itinerary copies."
          title="No itinerary yet"
        />
      ) : (
        <ol className="itinerary-list">
          {items.map((item, index) => (
            <li key={item.id}>
              <span className="itinerary-number">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div>
                <time dateTime={item.startsAt ?? undefined}>
                  {formatDateTime(item.startsAt)}
                </time>
                <h3>{item.displayName}</h3>
                <CanonicalId id={item.id} />
                <HistoryButton
                  objectId={item.id}
                  displayName={item.displayName}
                />
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function ExpensesPanel({
  canEdit,
  eventId,
  expenses,
}: {
  readonly canEdit: boolean;
  readonly eventId: string;
  readonly expenses: readonly ExpenseResponse[];
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const totals = useMemo(() => {
    const values = new Map<string, number>();
    for (const expense of expenses) {
      values.set(
        expense.currency,
        (values.get(expense.currency) ?? 0) + Number(expense.amount),
      );
    }
    return [...values.entries()];
  }, [expenses]);
  const editingExpense = expenses.find(({ id }) => id === editingId);

  return (
    <section className="planning-panel">
      <PanelHeading
        description="Historical transactions stay independent from the plans they support."
        title="Expenses"
      />
      {canEdit ? <ExpenseForm eventId={eventId} /> : null}
      {totals.length > 0 ? (
        <div className="total-row">
          <span>Total recorded</span>
          <strong>
            {totals
              .map(([currency, amount]) =>
                formatMoney(String(amount), currency),
              )
              .join(" + ")}
          </strong>
        </div>
      ) : null}
      {expenses.length === 0 ? (
        <EmptyState
          description="Record a transaction above when money changes hands."
          title="No expenses recorded"
        />
      ) : (
        <div className="resource-list">
          {expenses.map((expense) => (
            <article key={expense.id}>
              <div>
                <span className="object-label">
                  {formatDateTime(expense.occurredAt)}
                </span>
                <h3>{expense.displayName}</h3>
                <CanonicalId id={expense.id} />
              </div>
              <strong className="money-value">
                {formatMoney(expense.amount, expense.currency)}
              </strong>
              <HistoryButton
                objectId={expense.id}
                displayName={expense.displayName}
              />
              {canEdit ? (
                <LifecycleButton target={{ ...expense, eventId }} />
              ) : null}
              {canEdit ? (
                <button
                  className="button button-quiet button-small"
                  onClick={() => setEditingId(expense.id)}
                  type="button"
                >
                  Edit
                </button>
              ) : null}
            </article>
          ))}
        </div>
      )}
      {!canEdit || editingExpense === undefined ? null : (
        <div className="editor-drawer">
          <div className="drawer-heading">
            <h3>Edit expense</h3>
            <CanonicalId id={editingExpense.id} />
          </div>
          <ExpenseForm
            eventId={eventId}
            expense={editingExpense}
            onCancel={() => setEditingId(null)}
          />
        </div>
      )}
    </section>
  );
}

export function RemindersPanel({
  canEdit,
  eventId,
  reminders,
}: {
  readonly canEdit: boolean;
  readonly eventId: string;
  readonly reminders: readonly ReminderResponse[];
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const update = useUpdateReminder();
  const refresh = useRefreshEvent(eventId);
  const editingReminder = reminders.find(({ id }) => id === editingId);

  return (
    <section className="planning-panel">
      <PanelHeading
        description="Canonical alerts tied to the Event permission scope."
        title="Reminders"
      />
      {canEdit ? <ReminderForm eventId={eventId} /> : null}
      {update.isError ? (
        <ErrorNotice
          error={update.error}
          onRefresh={() => void refresh().then(() => update.reset())}
        />
      ) : null}
      {reminders.length === 0 ? (
        <EmptyState
          description="Add an alert for a decision or deadline that should not slip."
          title="No reminders"
        />
      ) : (
        <div className="resource-list reminder-list">
          {reminders.map((reminder) => (
            <article key={reminder.id}>
              <div className="reminder-time">
                <span>
                  {new Intl.DateTimeFormat(undefined, {
                    month: "short",
                  }).format(new Date(reminder.remindAt))}
                </span>
                <strong>
                  {new Intl.DateTimeFormat(undefined, {
                    day: "2-digit",
                  }).format(new Date(reminder.remindAt))}
                </strong>
              </div>
              <div>
                <span className="object-label">
                  {formatDateTime(reminder.remindAt)}
                </span>
                <h3>{reminder.displayName}</h3>
                <CanonicalId id={reminder.id} />
              </div>
              <span className={`status-chip status-${reminder.status}`}>
                {reminder.status}
              </span>
              <div className="row-actions">
                <HistoryButton
                  objectId={reminder.id}
                  displayName={reminder.displayName}
                />
                {canEdit ? (
                  <LifecycleButton target={{ ...reminder, eventId }} />
                ) : null}
                {canEdit && reminder.status === "pending" ? (
                  <button
                    className="button button-secondary button-small"
                    disabled={update.isPending}
                    onClick={() =>
                      update.mutate({
                        id: reminder.id,
                        input: {
                          expectedVersion: reminder.version,
                          status: "dismissed",
                        },
                      })
                    }
                    type="button"
                  >
                    Dismiss
                  </button>
                ) : null}
                {canEdit ? (
                  <button
                    className="button button-quiet button-small"
                    onClick={() => setEditingId(reminder.id)}
                    type="button"
                  >
                    Edit
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}
      {!canEdit || editingReminder === undefined ? null : (
        <div className="editor-drawer">
          <div className="drawer-heading">
            <h3>Edit reminder</h3>
            <CanonicalId id={editingReminder.id} />
          </div>
          <ReminderForm
            eventId={eventId}
            onCancel={() => setEditingId(null)}
            reminder={editingReminder}
          />
        </div>
      )}
    </section>
  );
}
