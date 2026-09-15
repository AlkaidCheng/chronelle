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
import { useMemo, useState } from "react";

import { EmptyState, ErrorNotice } from "../../components/feedback";
import { CheckIcon } from "../../components/icons";
import { HistoryButton } from "../history/history-button";
import { LifecycleButton } from "../recovery/lifecycle-provider";
import { ObjectDetails } from "../../components/object-details";
import {
  DateTile,
  objectTypeLabel,
  PanelHeading,
  RowActions,
  StatusChip,
} from "./component-frame";
import { ScheduleItemInspector } from "./schedule-item-inspector";
import { CreateScheduleDialog } from "./create-schedule-dialog";
import {
  formatCalendarDate,
  formatEventDatePart,
  formatEventSchedule,
} from "../../lib/event-schedule";
import { formatDatePart, formatDateTime } from "../../lib/format";
import { formatMoney, sumMoneyByCurrency } from "../../lib/money";
import {
  useRefreshEvent,
  useUpdateReminder,
  useUpdateTask,
} from "../../lib/queries";
import { ExpenseForm } from "./expense-form";
import { ExpenseInspector } from "./expense-inspector";
import { ReminderForm } from "./reminder-form";
import { ReminderInspector } from "./reminder-inspector";
import { TaskForm } from "./task-form";
import { TaskInspector } from "./task-inspector";

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
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const update = useUpdateTask();
  const { mutate: updateTask, isPending: isUpdatingTask } = update;
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
              disabled={!canEdit || isUpdatingTask}
              onClick={() =>
                updateTask({
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
            <ObjectDetails id={row.original.id} />
          </div>
        ),
      }),
      taskColumn.accessor("dueAt", {
        header: "Due",
        cell: ({ getValue }) => formatDateTime(getValue()),
      }),
      taskColumn.accessor("status", {
        header: "Status",
        cell: ({ getValue }) => <StatusChip status={getValue()} />,
      }),
      taskColumn.display({
        id: "actions",
        cell: ({ row }) => (
          <RowActions>
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
          </RowActions>
        ),
      }),
    ],
    [canEdit, isUpdatingTask, updateTask, eventId],
  );
  const table = useReactTable({
    columns,
    data: filteredTasks,
    getRowId: (task) => task.id,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <section className="planning-panel">
      <PanelHeading
        action={
          canEdit ? (
            <button
              className="button button-secondary"
              type="button"
              onClick={() => setIsAdding(true)}
            >
              Add task
            </button>
          ) : undefined
        }
        description="Keep the next steps clear. Tasks are sorted by due date and stay in sync across your plans."
        title="To-dos"
      />
      {canEdit && isAdding ? (
        <TaskForm
          key={eventId}
          eventId={eventId}
          onCancel={() => setIsAdding(false)}
        />
      ) : null}
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
              ? canEdit
                ? "Use Add task to choose the next step."
                : "Tasks will appear here when available. This event is read-only."
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
      {canEdit && editingId ? (
        <TaskInspector
          key={editingId}
          eventId={eventId}
          taskId={editingId}
          onClose={() => setEditingId(null)}
        />
      ) : null}
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
              onClick={() => setIsAdding(true)}
              type="button"
            >
              Add schedule item
            </button>
          ) : undefined
        }
        description="See what is happening and when. Schedule changes stay in sync with your itinerary."
        title="Calendar"
      />
      {isAdding && canEdit ? (
        <CreateScheduleDialog
          key={eventId}
          eventId={eventId}
          onClose={() => setIsAdding(false)}
        />
      ) : null}
      {items.length === 0 ? (
        <EmptyState
          description={
            canEdit
              ? "Use Add schedule item to plan a date or time."
              : "Scheduled items will appear here when available. This event is read-only."
          }
          title="Nothing scheduled"
        />
      ) : (
        <div className="resource-list">
          {items.map((item) => (
            <article key={item.id}>
              <DateTile
                dateTime={item.startsOn ?? item.startsAt ?? undefined}
                day={formatEventDatePart(item, "day")}
                month={formatEventDatePart(item, "month")}
              />
              <div className="resource-copy">
                <span className="object-label">{objectTypeLabel("event")}</span>
                <h3>{item.displayName}</h3>
                <p>{formatEventSchedule(item)}</p>
                <ObjectDetails id={item.id} />
              </div>
              <RowActions>
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
              </RowActions>
            </article>
          ))}
        </div>
      )}
      {!canEdit || editingEvent === undefined ? null : (
        <ScheduleItemInspector
          key={editingEvent.id}
          eventId={editingEvent.id}
          onClose={() => setEditingId(null)}
        />
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
        description="The full picture, in order: your schedule, tasks, expenses, and reminders."
        title="Timeline"
      />
      {timeline.items.length === 0 ? (
        <EmptyState
          description="Dated schedule items, tasks, expenses, and reminders appear here automatically."
          title="No timeline entries"
        />
      ) : (
        <ol className="timeline-list">
          {timeline.items.map((item) => (
            <li key={`${item.objectType}:${item.canonicalObjectId}`}>
              <span className={`timeline-dot object-${item.objectType}`} />
              <time dateTime={item.occursOn ?? item.occursAt ?? undefined}>
                {item.occursOn
                  ? formatCalendarDate(item.occursOn)
                  : formatDateTime(item.occursAt)}
              </time>
              <div>
                <span className="object-label">
                  {objectTypeLabel(item.objectType)}
                </span>
                <h3>{item.displayName}</h3>
                <ObjectDetails id={item.canonicalObjectId} />
                <RowActions>
                  <HistoryButton
                    objectId={item.canonicalObjectId}
                    displayName={item.displayName}
                  />
                </RowActions>
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
          description="Scheduled items appear here in date order."
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
                <time dateTime={item.startsOn ?? item.startsAt ?? undefined}>
                  {formatEventSchedule(item)}
                </time>
                <h3>{item.displayName}</h3>
                <ObjectDetails id={item.id} />
                <RowActions>
                  <HistoryButton
                    objectId={item.id}
                    displayName={item.displayName}
                  />
                </RowActions>
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
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const totals = useMemo(() => sumMoneyByCurrency(expenses), [expenses]);

  return (
    <section className="planning-panel">
      <PanelHeading
        description="Historical transactions stay independent from the plans they support."
        title="Expenses"
        action={
          canEdit ? (
            <button
              className="button button-secondary"
              type="button"
              onClick={() => setIsAdding(true)}
            >
              Add expense
            </button>
          ) : null
        }
      />
      {canEdit && isAdding ? (
        <ExpenseForm
          key={eventId}
          eventId={eventId}
          onCancel={() => setIsAdding(false)}
        />
      ) : null}
      {totals.length > 0 ? (
        <div className="total-row">
          <span>Total recorded</span>
          <dl aria-label="Totals by currency" className="money-totals">
            {totals.map(({ amount, currency }) => (
              <div key={currency}>
                <dt>{currency}</dt>
                <dd>
                  <strong>{formatMoney(amount, currency)}</strong>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
      {expenses.length === 0 ? (
        <EmptyState
          description={
            canEdit
              ? "Use Add expense to record a transaction."
              : "Recorded transactions will appear here when available. This event is read-only."
          }
          title="No expenses recorded"
        />
      ) : (
        <div className="resource-list">
          {expenses.map((expense) => (
            <article key={expense.id}>
              <div className="resource-copy">
                <span className="object-label">
                  {formatDateTime(expense.occurredAt)}
                </span>
                <h3>{expense.displayName}</h3>
                <ObjectDetails id={expense.id} />
              </div>
              <strong className="money-value">
                {formatMoney(expense.amount, expense.currency)}
              </strong>
              <RowActions>
                {canEdit ? (
                  <button
                    className="button button-quiet button-small"
                    onClick={() => setEditingId(expense.id)}
                    type="button"
                  >
                    Edit
                  </button>
                ) : null}
                <HistoryButton
                  objectId={expense.id}
                  displayName={expense.displayName}
                />
                {canEdit ? (
                  <LifecycleButton target={{ ...expense, eventId }} />
                ) : null}
              </RowActions>
            </article>
          ))}
        </div>
      )}
      {canEdit && editingId ? (
        <ExpenseInspector
          key={editingId}
          eventId={eventId}
          expenseId={editingId}
          onClose={() => setEditingId(null)}
        />
      ) : null}
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
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const update = useUpdateReminder();
  const refresh = useRefreshEvent(eventId);

  return (
    <section className="planning-panel">
      <PanelHeading
        description="Keep track of what needs a nudge. Reminders are recorded here; notifications are not sent yet."
        title="Reminders"
        action={
          canEdit ? (
            <button
              className="button button-secondary"
              type="button"
              onClick={() => setIsAdding(true)}
            >
              Add reminder
            </button>
          ) : null
        }
      />
      {canEdit && isAdding ? (
        <ReminderForm
          key={eventId}
          eventId={eventId}
          onCancel={() => setIsAdding(false)}
        />
      ) : null}
      {update.isError ? (
        <ErrorNotice
          error={update.error}
          onRefresh={() => void refresh().then(() => update.reset())}
        />
      ) : null}
      {reminders.length === 0 ? (
        <EmptyState
          description={
            canEdit
              ? "Record a reminder when you know the time."
              : "Reminders will appear here when available. This event is read-only."
          }
          title="No reminders"
        />
      ) : (
        <div className="resource-list">
          {reminders.map((reminder) => (
            <article key={reminder.id}>
              <DateTile
                dateTime={reminder.remindAt}
                day={formatDatePart(reminder.remindAt, "day")}
                month={formatDatePart(reminder.remindAt, "month")}
              />
              <div className="resource-copy">
                <span className="object-label">
                  {formatDateTime(reminder.remindAt)}
                </span>
                <h3>{reminder.displayName}</h3>
                <ObjectDetails id={reminder.id} />
              </div>
              <StatusChip status={reminder.status} />
              <RowActions>
                {canEdit ? (
                  <button
                    className="button button-quiet button-small"
                    onClick={() => setEditingId(reminder.id)}
                    type="button"
                  >
                    Edit
                  </button>
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
                <HistoryButton
                  objectId={reminder.id}
                  displayName={reminder.displayName}
                />
                {canEdit ? (
                  <LifecycleButton target={{ ...reminder, eventId }} />
                ) : null}
              </RowActions>
            </article>
          ))}
        </div>
      )}
      {!canEdit || editingId === null ? null : (
        <ReminderInspector
          key={editingId}
          eventId={eventId}
          onClose={() => setEditingId(null)}
          reminderId={editingId}
        />
      )}
    </section>
  );
}
