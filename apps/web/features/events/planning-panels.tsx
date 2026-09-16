"use client";

import type {
  EventComponentView,
  EventResponse,
  ExpenseResponse,
  ReminderResponse,
  TaskResponse,
  TimelineResponse,
} from "@chronelle/schemas";
import { useCallback, useMemo, useState } from "react";

import { EmptyState, ErrorNotice } from "../../components/feedback";
import {
  type DayKey,
  eventDays,
  instantDay,
  placeByDay,
} from "../../lib/day-placement";
import { HistoryButton } from "../history/history-button";
import { LifecycleButton } from "../recovery/lifecycle-provider";
import { ObjectDetails } from "../../components/object-details";
import {
  DateTile,
  objectTypeLabel,
  PanelHeading,
  RowActions,
  StatusChip,
  ViewSwitch,
} from "./component-frame";
import { ScheduleItemInspector } from "./schedule-item-inspector";
import { CreateScheduleDialog } from "./create-schedule-dialog";
import {
  formatCalendarDate,
  formatEventDatePart,
  formatEventSchedule,
} from "../../lib/event-schedule";
import { viewsOf } from "../../lib/event-components";
import { formatDatePart, formatDateTime, formatTime } from "../../lib/format";
import { deriveTaskTree } from "../../lib/task-tree";
import { groupByDay } from "../../lib/day-groups";
import { usePeriod } from "../../lib/use-period";
import { PeriodView } from "./period-view";
import { formatMoney, sumMoneyByCurrency } from "../../lib/money";
import {
  useLabelsQuery,
  usePersonsQuery,
  useRefreshEvent,
  useUpdateReminder,
} from "../../lib/queries";
import { ExpenseForm } from "./expense-form";
import { ExpenseInspector } from "./expense-inspector";
import { ReminderForm } from "./reminder-form";
import { ReminderInspector } from "./reminder-inspector";
import { type SubtaskParent, TaskForm } from "./task-form";
import { TaskInspector } from "./task-inspector";
import { TaskListView } from "../tasks/task-list-view";

type TaskFilter = "all" | "open" | "done";

export function TasksPanel({
  canEdit,
  eventId,
  isSavingView = false,
  onChangeView,
  tasks,
  view = "list",
}: {
  readonly canEdit: boolean;
  readonly eventId: string;
  readonly isSavingView?: boolean;
  readonly onChangeView?: ((view: EventComponentView) => void) | undefined;
  readonly tasks: readonly TaskResponse[];
  readonly view?: EventComponentView;
}) {
  const [filter, setFilter] = useState<TaskFilter>("open");
  const [isAdding, setIsAdding] = useState(false);
  const [parent, setParent] = useState<SubtaskParent | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const refresh = useRefreshEvent(eventId);
  const period = usePeriod(view);
  // The projection holds every task of the Event, so the tree is derived here.
  const tree = useMemo(() => deriveTaskTree(tasks), [tasks]);
  const labels = useLabelsQuery();
  const persons = usePersonsQuery();
  // Stable, so the row cells keep their identity and focus across renders.
  const addSubtask = useCallback(
    (task: TaskResponse) =>
      setParent({
        id: task.id,
        displayName: task.displayName,
        permissionScopeId: task.permissionScopeId,
      }),
    [],
  );
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
        controls={
          onChangeView === undefined ? undefined : (
            <ViewSwitch
              busy={isSavingView}
              onChange={onChangeView}
              view={view}
              views={viewsOf("todos")}
            />
          )
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
      {canEdit && parent !== null ? (
        <TaskForm
          key={`sub:${parent.id}`}
          eventId={eventId}
          onCancel={() => setParent(null)}
          parent={parent}
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
        <TaskListView
          canEdit={canEdit}
          eventId={eventId}
          labelNames={labels.data?.names}
          onAddSubtask={addSubtask}
          onEdit={setEditingId}
          onRefresh={refresh}
          parents={tree.parents}
          period={period}
          personNames={persons.data?.names}
          progress={tree.progress}
          tasks={filteredTasks}
          view={view}
        />
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
  isSavingView,
  items,
  onChangeView,
  view = "list",
}: {
  readonly canEdit: boolean;
  readonly eventId: string;
  readonly isSavingView?: boolean | undefined;
  readonly items: readonly EventResponse[];
  readonly onChangeView?: ((view: EventComponentView) => void) | undefined;
  readonly view?: EventComponentView;
}) {
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const editingEvent = items.find(({ id }) => id === editingId);
  const period = usePeriod(view);
  const placed = useMemo(
    () =>
      view === "week" || view === "month"
        ? placeByDay(items, eventDays)
        : new Map<DayKey, EventResponse[]>(),
    [items, view],
  );
  const unscheduled = useMemo(
    () =>
      view === "week" || view === "month"
        ? items.filter((item) => eventDays(item).length === 0)
        : [],
    [items, view],
  );
  const rowActions = (item: EventResponse) => (
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
      <HistoryButton objectId={item.id} displayName={item.displayName} />
      {canEdit ? <LifecycleButton target={{ ...item, eventId }} /> : null}
    </RowActions>
  );
  const scheduleRow = (item: EventResponse) => (
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
      {rowActions(item)}
    </article>
  );
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
        controls={
          onChangeView === undefined ? undefined : (
            <ViewSwitch
              busy={isSavingView ?? false}
              onChange={onChangeView}
              view={view}
              views={viewsOf("calendar")}
            />
          )
        }
        description="See what is happening and when, as a list, a running order, a week, or a month."
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
      ) : view === "agenda" ? (
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
                {rowActions(item)}
              </div>
            </li>
          ))}
        </ol>
      ) : view === "week" || view === "month" ? (
        <PeriodView
          cellOf={(item) => (
            <span>
              {item.startsAt !== null && item.startsOn === null
                ? `${formatTime(item.startsAt)} `
                : ""}
              {item.displayName}
            </span>
          )}
          emptyDay="Nothing scheduled this day."
          period={period}
          placed={placed}
          renderList={(dayItems, compact) => (
            <div
              className={`resource-list${compact ? " resource-list-compact" : ""}`}
            >
              {dayItems.map(scheduleRow)}
            </div>
          )}
          undated={unscheduled}
          undatedLabel="Unscheduled"
          view={view}
        />
      ) : (
        <div className="resource-list">{items.map(scheduleRow)}</div>
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

/** The local day a transaction happened. */
const expenseDay = (expense: ExpenseResponse) => instantDay(expense.occurredAt);

/** The local day a reminder is due. */
const reminderDay = (reminder: ReminderResponse) =>
  instantDay(reminder.remindAt);

export function ExpensesPanel({
  canEdit,
  eventId,
  expenses,
  isSavingView,
  onChangeView,
  view = "list",
}: {
  readonly canEdit: boolean;
  readonly eventId: string;
  readonly expenses: readonly ExpenseResponse[];
  readonly isSavingView?: boolean | undefined;
  readonly onChangeView?: ((view: EventComponentView) => void) | undefined;
  readonly view?: EventComponentView;
}) {
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const totals = useMemo(() => sumMoneyByCurrency(expenses), [expenses]);
  const period = usePeriod(view);
  const placed = useMemo(
    () =>
      view === "week" || view === "month"
        ? placeByDay(expenses, (expense) => [expenseDay(expense)])
        : new Map<DayKey, ExpenseResponse[]>(),
    [expenses, view],
  );
  const groups = useMemo(
    () =>
      view === "by-day" ? groupByDay(expenses, expenseDay, new Date()) : [],
    [expenses, view],
  );
  const expenseRow = (expense: ExpenseResponse) => (
    <article key={expense.id}>
      <div className="resource-copy">
        <span className="object-label">
          {view === "list" || view === "week"
            ? formatDateTime(expense.occurredAt)
            : formatTime(expense.occurredAt)}
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
        {canEdit ? <LifecycleButton target={{ ...expense, eventId }} /> : null}
      </RowActions>
    </article>
  );
  // A day's totals by currency, in the heading of a by-day group and under a month's day.
  const dayTotals = (dayExpenses: readonly ExpenseResponse[]) => (
    <span className="day-group-totals">
      {sumMoneyByCurrency(dayExpenses).map(({ amount, currency }) => (
        <span key={currency}>{formatMoney(amount, currency)}</span>
      ))}
    </span>
  );
  const expenseList = (
    dayExpenses: readonly ExpenseResponse[],
    compact: boolean,
  ) => (
    <div className={`resource-list${compact ? " resource-list-compact" : ""}`}>
      {dayExpenses.map(expenseRow)}
      {compact ? null : (
        <p className="day-group-sum">
          <span>Day total</span>
          {dayTotals(dayExpenses)}
        </p>
      )}
    </div>
  );

  return (
    <section className="planning-panel">
      <PanelHeading
        controls={
          onChangeView === undefined ? undefined : (
            <ViewSwitch
              busy={isSavingView ?? false}
              onChange={onChangeView}
              view={view}
              views={viewsOf("expenses")}
            />
          )
        }
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
      ) : view === "by-day" ? (
        <div className="day-groups">
          {groups.map((group) => (
            <section
              aria-label={group.label.join(", ")}
              className={`day-group day-group-${group.tone}`}
              key={group.key}
            >
              <h3 className="day-group-heading">
                {group.label.map((part) => (
                  <span key={part}>{part}</span>
                ))}
                {dayTotals(group.items)}
              </h3>
              <div className="resource-list">{group.items.map(expenseRow)}</div>
            </section>
          ))}
        </div>
      ) : view === "week" || view === "month" ? (
        <PeriodView
          cellOf={(expense) => (
            <span>
              {formatMoney(expense.amount, expense.currency)}{" "}
              {expense.displayName}
            </span>
          )}
          emptyDay="Nothing recorded this day."
          period={period}
          placed={placed}
          renderList={expenseList}
          undated={[]}
          undatedLabel="Undated"
          view={view}
        />
      ) : (
        <div className="resource-list">{expenses.map(expenseRow)}</div>
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
  isSavingView,
  onChangeView,
  reminders,
  view = "list",
}: {
  readonly canEdit: boolean;
  readonly eventId: string;
  readonly isSavingView?: boolean | undefined;
  readonly onChangeView?: ((view: EventComponentView) => void) | undefined;
  readonly reminders: readonly ReminderResponse[];
  readonly view?: EventComponentView;
}) {
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const update = useUpdateReminder();
  const refresh = useRefreshEvent(eventId);
  const period = usePeriod(view);
  const placed = useMemo(
    () =>
      view === "week" || view === "month"
        ? placeByDay(reminders, (reminder) => [reminderDay(reminder)])
        : new Map<DayKey, ReminderResponse[]>(),
    [reminders, view],
  );
  const groups = useMemo(
    () =>
      view === "by-day" ? groupByDay(reminders, reminderDay, new Date()) : [],
    [reminders, view],
  );
  const reminderRow = (reminder: ReminderResponse) => (
    <article key={reminder.id}>
      <DateTile
        dateTime={reminder.remindAt}
        day={formatDatePart(reminder.remindAt, "day")}
        month={formatDatePart(reminder.remindAt, "month")}
      />
      <div className="resource-copy">
        <span className="object-label">
          {view === "list"
            ? formatDateTime(reminder.remindAt)
            : formatTime(reminder.remindAt)}
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
        {canEdit ? <LifecycleButton target={{ ...reminder, eventId }} /> : null}
      </RowActions>
    </article>
  );
  const reminderList = (
    dayReminders: readonly ReminderResponse[],
    compact: boolean,
  ) => (
    <div className={`resource-list${compact ? " resource-list-compact" : ""}`}>
      {dayReminders.map(reminderRow)}
    </div>
  );

  return (
    <section className="planning-panel">
      <PanelHeading
        controls={
          onChangeView === undefined ? undefined : (
            <ViewSwitch
              busy={isSavingView ?? false}
              onChange={onChangeView}
              view={view}
              views={viewsOf("reminders")}
            />
          )
        }
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
      ) : view === "by-day" ? (
        <div className="day-groups">
          {groups.map((group) => (
            <section
              aria-label={group.label.join(", ")}
              className={`day-group day-group-${group.tone}`}
              key={group.key}
            >
              <h3 className="day-group-heading">
                {group.label.map((part) => (
                  <span key={part}>{part}</span>
                ))}
              </h3>
              <div className="resource-list">
                {group.items.map(reminderRow)}
              </div>
            </section>
          ))}
        </div>
      ) : view === "week" || view === "month" ? (
        <PeriodView
          cellOf={(reminder) => (
            <span
              className={reminder.status === "pending" ? undefined : "is-done"}
            >
              {formatTime(reminder.remindAt)} {reminder.displayName}
            </span>
          )}
          emptyDay="No reminders this day."
          period={period}
          placed={placed}
          renderList={reminderList}
          undated={[]}
          undatedLabel="Undated"
          view={view}
        />
      ) : (
        <div className="resource-list">{reminders.map(reminderRow)}</div>
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
