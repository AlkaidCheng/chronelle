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

import { RowMenu, type RowMenuEntry } from "../../components/row-menu";
import {
  byRank,
  rankAtIndex,
  rankForStep,
  staysInPlace,
} from "../../lib/collection-order";
import { dayInWords, dueShortcuts } from "../../lib/due-choices";
import { instantOnDay } from "../../lib/task-due";
import { useOpenHistory } from "../history/history-provider";
import { useOpenLifecycle } from "../recovery/lifecycle-provider";
import { type RowDrop, useRowDrag } from "../../lib/use-row-drag";

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
  useSessionQuery,
  useUpdateReminder,
} from "../../lib/queries";
import { ExpenseForm } from "./expense-form";
import { ExpenseInspector } from "./expense-inspector";
import { ReminderForm } from "./reminder-form";
import { ReminderInspector } from "./reminder-inspector";
import { QuickAddReminder } from "./quick-add-reminder";
import { type SubtaskParent, TaskForm } from "./task-form";
import { TaskInspector } from "./task-inspector";
import { TaskListView } from "../tasks/task-list-view";

type TaskFilter = "all" | "open" | "done";

/** Named choices in name order, for a filter over what the tasks carry. */
function namedChoices(
  ids: Iterable<string>,
  names: ReadonlyMap<string, string> | undefined,
): { readonly id: string; readonly name: string }[] {
  const choices: { id: string; name: string }[] = [];
  for (const id of new Set(ids)) {
    const name = names?.get(id);
    if (name !== undefined) choices.push({ id, name });
  }
  return choices.sort(
    (a, b) =>
      a.name.toLowerCase().localeCompare(b.name.toLowerCase()) ||
      a.id.localeCompare(b.id),
  );
}

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
  const [label, setLabel] = useState("");
  const [assignee, setAssignee] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [parent, setParent] = useState<SubtaskParent | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const refresh = useRefreshEvent(eventId);
  const period = usePeriod(view);
  // The projection holds every task of the Event, so the tree is derived here.
  const tree = useMemo(() => deriveTaskTree(tasks), [tasks]);
  const labels = useLabelsQuery();
  const persons = usePersonsQuery();
  const session = useSessionQuery();
  // The person linked to the signed-in account, when one exists.
  const myPerson = persons.data?.items.find(
    (person) =>
      session.data !== undefined && person.userId === session.data.user.id,
  );
  // The labels and people the tasks carry, so the filters offer only what
  // can match; a choice the tasks no longer carry falls back to any.
  const labelChoices = useMemo(
    () =>
      namedChoices(
        tasks.flatMap((task) => task.labelIds),
        labels.data?.names,
      ),
    [labels.data, tasks],
  );
  const assigneeChoices = useMemo(
    () =>
      namedChoices(
        tasks.flatMap((task) =>
          task.assigneeId === null || task.assigneeId === myPerson?.id
            ? []
            : [task.assigneeId],
        ),
        persons.data?.names,
      ),
    [myPerson?.id, persons.data, tasks],
  );
  const meAssigned =
    myPerson !== undefined &&
    tasks.some((task) => task.assigneeId === myPerson.id);
  const activeLabel = labelChoices.some(({ id }) => id === label) ? label : "";
  const activeAssignee =
    (meAssigned && assignee === myPerson?.id) ||
    assigneeChoices.some(({ id }) => id === assignee)
      ? assignee
      : "";
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
  // The projection lists by due; the component keeps its manual order.
  const filteredTasks = useMemo(
    () =>
      tasks
        .filter((task) => {
          if (activeLabel !== "" && !task.labelIds.includes(activeLabel))
            return false;
          if (activeAssignee !== "" && task.assigneeId !== activeAssignee)
            return false;
          if (filter === "open") {
            return task.status !== "done" && task.status !== "cancelled";
          }
          if (filter === "done") {
            return task.status === "done";
          }
          return true;
        })
        .sort(byRank),
    [activeAssignee, activeLabel, filter, tasks],
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
        description="Keep the next steps clear. Drag a task to reorder it; tasks stay in sync across your plans."
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
      <div className="filter-bar">
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
        {labelChoices.length === 0 ? null : (
          <label className="compact-field collection-sort">
            <span className="visually-hidden">Filter by label</span>
            <select
              onChange={(event) => setLabel(event.target.value)}
              value={activeLabel}
            >
              <option value="">Any label</option>
              {labelChoices.map((choice) => (
                <option key={choice.id} value={choice.id}>
                  {choice.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {!meAssigned && assigneeChoices.length === 0 ? null : (
          <label className="compact-field collection-sort">
            <span className="visually-hidden">Filter by assignee</span>
            <select
              onChange={(event) => setAssignee(event.target.value)}
              value={activeAssignee}
            >
              <option value="">Anyone</option>
              {meAssigned && myPerson !== undefined ? (
                <option value={myPerson.id}>Me</option>
              ) : null}
              {assigneeChoices.map((choice) => (
                <option key={choice.id} value={choice.id}>
                  {choice.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {filteredTasks.length === 0 ? (
        <EmptyState
          description={
            tasks.length === 0
              ? canEdit
                ? "Use Add task to choose the next step."
                : "Tasks will appear here when available. This event is read-only."
              : activeLabel !== "" || activeAssignee !== ""
                ? filter === "all"
                  ? "No tasks match these filters."
                  : `No ${filter} tasks match these filters.`
                : `There are no ${filter} tasks.`
          }
          title={tasks.length === 0 ? "No tasks yet" : "Nothing in this view"}
        />
      ) : (
        <TaskListView
          canEdit={canEdit}
          eventId={eventId}
          labelNames={labels.data?.names}
          manual
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
  reminders: listed,
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
  const [announcement, setAnnouncement] = useState("");
  const update = useUpdateReminder();
  const refresh = useRefreshEvent(eventId);
  const period = usePeriod(view);
  const openHistory = useOpenHistory();
  const openLifecycle = useOpenLifecycle();
  // The projection lists by time; the component keeps its manual order.
  const reminders = useMemo(() => [...listed].sort(byRank), [listed]);
  const byId = useMemo(
    () => new Map(reminders.map((reminder) => [reminder.id, reminder])),
    [reminders],
  );
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
  const rowsOf = useCallback(
    (groupKey: string): readonly ReminderResponse[] =>
      groupKey === "all"
        ? reminders
        : (groups.find((group) => group.key === groupKey)?.items ?? []),
    [groups, reminders],
  );
  const change = useCallback(
    (
      reminder: ReminderResponse,
      input: Record<string, unknown>,
      said: string,
    ) => {
      update.mutate(
        {
          id: reminder.id,
          input: { expectedVersion: reminder.version, ...input },
        },
        { onSuccess: () => setAnnouncement(said) },
      );
    },
    [update],
  );
  const snooze = useCallback(
    (reminder: ReminderResponse, day: DayKey, rank?: string) =>
      change(
        reminder,
        {
          remindAt: instantOnDay(reminder.remindAt, day),
          ...(rank === undefined ? {} : { rank }),
        },
        `${reminder.displayName} is due ${dayInWords(day, new Date())}.`,
      ),
    [change],
  );
  const onDrop = useCallback(
    (id: string, drop: RowDrop) => {
      const reminder = byId.get(id);
      if (reminder === undefined) return;
      const from = view === "by-day" ? reminderDay(reminder) : "all";
      const rows = drop.rowIds.flatMap((rowId) => byId.get(rowId) ?? []);
      if (
        drop.groupKey === from &&
        staysInPlace(rowsOf(from), id, rows, drop.index)
      )
        return;
      const rank = rankAtIndex(rows, drop.index);
      if (drop.groupKey !== "all" && drop.groupKey !== from)
        snooze(reminder, drop.groupKey, rank);
      else change(reminder, { rank }, `${reminder.displayName} moved.`);
    },
    [byId, change, rowsOf, snooze, view],
  );
  const labelOf = useCallback(
    (id: string) => byId.get(id)?.displayName ?? "",
    [byId],
  );
  const { drag, groupProps, rowClass, rowProps } = useRowDrag({
    enabled: canEdit && (view === "list" || view === "by-day"),
    labelOf,
    onDrop,
  });
  const menu = (
    reminder: ReminderResponse,
    rows: readonly ReminderResponse[],
  ) => {
    const now = new Date();
    const day = reminderDay(reminder);
    const at = rows.findIndex((row) => row.id === reminder.id);
    const step = (direction: -1 | 1) => {
      const rank = rankForStep(rows, reminder.id, direction);
      if (rank === null) return;
      change(
        reminder,
        { rank },
        `${reminder.displayName} is now ${at + direction + 1} of ${rows.length}.`,
      );
    };
    const entries: RowMenuEntry[] = canEdit
      ? [
          {
            kind: "action",
            label: "Edit",
            onSelect: () => setEditingId(reminder.id),
          },
          ...(reminder.status === "pending"
            ? [
                {
                  kind: "action" as const,
                  label: "Dismiss",
                  onSelect: () =>
                    change(
                      reminder,
                      { status: "dismissed" },
                      `${reminder.displayName} dismissed.`,
                    ),
                },
              ]
            : []),
          {
            kind: "action",
            label: "Move up",
            disabled: at <= 0,
            onSelect: () => step(-1),
          },
          {
            kind: "action",
            label: "Move down",
            disabled: at < 0 || at >= rows.length - 1,
            onSelect: () => step(1),
          },
          { kind: "rule" },
          {
            kind: "choices",
            label: "Snooze",
            note: `Now ${dayInWords(day, now)}, ${formatTime(reminder.remindAt)}`,
            choices: dueShortcuts(now).map((shortcut) => ({
              label: shortcut.label,
              checked: day === shortcut.day,
              onSelect: () => {
                if (day !== shortcut.day) snooze(reminder, shortcut.day);
              },
            })),
          },
          { kind: "rule" },
          {
            kind: "action",
            label: "History",
            onSelect: () =>
              openHistory({
                objectId: reminder.id,
                displayName: reminder.displayName,
              }),
          },
          { kind: "rule" },
          {
            kind: "action",
            label: "Move to Trash",
            danger: true,
            onSelect: () => openLifecycle({ ...reminder, eventId }),
          },
        ]
      : [
          {
            kind: "action",
            label: "History",
            onSelect: () =>
              openHistory({
                objectId: reminder.id,
                displayName: reminder.displayName,
              }),
          },
        ];
    return (
      <RowMenu
        entries={entries}
        label={`Actions for ${reminder.displayName}`}
      />
    );
  };
  const reminderRow = (
    reminder: ReminderResponse,
    rows: readonly ReminderResponse[],
    groupKey: string,
  ) => (
    <article
      className={rowClass(groupKey, reminder.id)}
      id={`reminder-${reminder.id}`}
      key={reminder.id}
      {...rowProps(reminder.id)}
    >
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
      {menu(reminder, rows)}
    </article>
  );
  const reminderList = (
    dayReminders: readonly ReminderResponse[],
    compact: boolean,
  ) => (
    <div className={`resource-list${compact ? " resource-list-compact" : ""}`}>
      {dayReminders.map((reminder) =>
        reminderRow(reminder, dayReminders, "all"),
      )}
    </div>
  );
  const notice = (
    <>
      {update.isError ? (
        <ErrorNotice
          error={update.error}
          onRefresh={() => void refresh().then(() => update.reset())}
        />
      ) : null}
      <p aria-live="polite" className="visually-hidden" role="status">
        {announcement}
      </p>
      {drag === null ? null : (
        <div
          aria-hidden="true"
          className="row-drag-ghost"
          style={{
            transform: `translate(${drag.x}px, ${drag.y}px)`,
            width: drag.width,
          }}
        >
          {drag.label}
        </div>
      )}
    </>
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
      {view === "week" || view === "month" ? null : notice}
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
              <div className="resource-list" {...groupProps(group.key)}>
                {group.items.map((reminder) =>
                  reminderRow(reminder, group.items, group.key),
                )}
                {canEdit ? (
                  <div className="quick-add-item">
                    <QuickAddReminder
                      day={group.key}
                      dayLabel={group.label[0]}
                      eventId={eventId}
                    />
                  </div>
                ) : null}
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
          notice={notice}
          period={period}
          placed={placed}
          renderList={reminderList}
          undated={[]}
          undatedLabel="Undated"
          view={view}
        />
      ) : (
        <div className="resource-list" {...groupProps("all")}>
          {reminders.map((reminder) => reminderRow(reminder, reminders, "all"))}
          {canEdit ? (
            <div className="quick-add-item">
              <QuickAddReminder day={null} eventId={eventId} />
            </div>
          ) : null}
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
