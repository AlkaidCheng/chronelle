"use client";

import type {
  EventComponentView,
  EventResponse,
  ExpenseResponse,
  ReminderResponse,
  TaskResponse,
  TimelineResponse,
} from "@chronelle/schemas";
import { useTranslations } from "next-intl";
import {
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { EmptyState, ErrorNotice } from "../../components/feedback";
import { PinIcon } from "../../components/icons";
import { AddRow, useQuickAddSlots } from "../../components/quick-add-row";
import { RowMenu, type RowMenuEntry } from "../../components/row-menu";
import {
  byRank,
  rankAtIndex,
  rankForStep,
  staysInPlace,
} from "../../lib/collection-order";
import { groupByDay } from "../../lib/day-groups";
import {
  type DayKey,
  dayKeyOf,
  eventDays,
  instantDay,
  placeByDay,
  taskDay,
} from "../../lib/day-placement";
import { dayInWords, dueShortcuts } from "../../lib/due-choices";
import { viewsOf } from "../../lib/event-components";
import {
  formatCalendarDate,
  formatEventDatePart,
  formatEventSchedule,
} from "../../lib/event-schedule";
import {
  compareNames,
  formatDatePart,
  formatDateTime,
  formatTime,
} from "../../lib/format";
import { formatMoney, sumMoneyByCurrency } from "../../lib/money";
import {
  useLabelsQuery,
  usePersonsQuery,
  useRefreshEvent,
  useSessionQuery,
  useUpdateReminder,
} from "../../lib/queries";
import { instantOnDay } from "../../lib/task-due";
import { sortTasks, type TaskSort } from "../../lib/task-sort";
import { deriveTaskTree } from "../../lib/task-tree";
import { usePeriod } from "../../lib/use-period";
import { type RowDrop, useRowDrag } from "../../lib/use-row-drag";
import { HistoryButton } from "../history/history-button";
import { useOpenHistory } from "../history/history-provider";
import {
  LifecycleButton,
  useOpenLifecycle,
} from "../recovery/lifecycle-provider";
import { QuickAddTask } from "../tasks/quick-add-task";
import {
  activeFilterCount,
  defaultTaskFilters,
  TaskFilterControl,
  type TaskFilters,
  TaskSortControl,
} from "../tasks/task-controls";
import {
  resourceListClass,
  rowClasses,
  TaskListView,
} from "../tasks/task-list-view";
import {
  DateTile,
  LayoutControl,
  objectTypeLabel,
  PanelHeading,
  RowActions,
  StatusChip,
} from "./component-frame";
import { CreateScheduleDialog } from "./create-schedule-dialog";
import { ExpenseForm } from "./expense-form";
import { ExpenseInspector } from "./expense-inspector";
import { PeriodView, type RowMode } from "./period-view";
import { QuickAddReminder } from "./quick-add-reminder";
import { ReminderForm } from "./reminder-form";
import { ReminderInspector } from "./reminder-inspector";
import { ScheduleItemInspector } from "./schedule-item-inspector";
import { type SubtaskParent, TaskForm } from "./task-form";
import { TaskInspector } from "./task-inspector";

function isOpen(task: TaskResponse): boolean {
  return task.status !== "done" && task.status !== "cancelled";
}

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
    (a, b) => compareNames(a.name, b.name) || a.id.localeCompare(b.id),
  );
}

/**
 * Brings focus back to a panel's add row once its editor closes. The row the
 * editor came from is closed by then, and the list may replace the row as it
 * takes its first item, so for a moment after the close every render that
 * finds focus lost (on the body or the workspace) moves it to the row.
 */
function useReturnFocusToAddRow(panel: RefObject<HTMLElement | null>) {
  const until = useRef(0);
  useEffect(() => {
    if (Date.now() > until.current) return;
    const active = document.activeElement;
    if (active === document.body || active?.id === "workspace-content")
      panel.current?.querySelector<HTMLElement>(".quick-add")?.focus();
  });
  return useCallback(() => {
    until.current = Date.now() + 1500;
  }, []);
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
  const t = useTranslations("todos");
  const [filters, setFilters] = useState<TaskFilters>({
    ...defaultTaskFilters,
    timed: false,
    overdue: false,
  });
  const [sort, setSort] = useState<TaskSort>("manual");
  // The full editor for a new task opens from a quick add row, with what
  // was typed there and the row's day.
  const [adding, setAdding] = useState<{
    displayName: string;
    dueOn: string | null;
  } | null>(null);
  const panel = useRef<HTMLElement>(null);
  const returnFocus = useReturnFocusToAddRow(panel);
  const closeAdding = useCallback(() => {
    setAdding(null);
    returnFocus();
  }, [returnFocus]);
  const [parent, setParent] = useState<SubtaskParent | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const refresh = useRefreshEvent(eventId);
  const period = usePeriod(view);
  const quickAdd = useQuickAddSlots();
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
  const activeLabel = labelChoices.some(({ id }) => id === filters.label)
    ? filters.label
    : "";
  const activeAssignee =
    (meAssigned && filters.assignee === myPerson?.id) ||
    assigneeChoices.some(({ id }) => id === filters.assignee)
      ? filters.assignee
      : "";
  const activeFilters: TaskFilters = {
    ...filters,
    label: activeLabel,
    assignee: activeAssignee,
  };
  const filterCount = activeFilterCount(activeFilters);
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
  // The projection lists by due; the component orders as Sort says, its
  // manual order unless another is chosen.
  const filteredTasks = useMemo(() => {
    const today = dayKeyOf(new Date());
    const { status, timed, overdue } = filters;
    return sortTasks(
      tasks.filter((task) => {
        if (activeLabel !== "" && !task.labelIds.includes(activeLabel))
          return false;
        if (activeAssignee !== "" && task.assigneeId !== activeAssignee)
          return false;
        if (timed === true && task.dueAt === null) return false;
        if (overdue === true) {
          const day = taskDay(task);
          if (day === null || day >= today || !isOpen(task)) return false;
        }
        if (status === "open") return isOpen(task);
        if (status === "done") return task.status === "done";
        return true;
      }),
      sort,
    );
  }, [activeAssignee, activeLabel, filters, sort, tasks]);
  const openCount = tasks.filter(isOpen).length;
  const shownOpen = filteredTasks.filter(isOpen).length;

  return (
    <section className="planning-panel" ref={panel}>
      <PanelHeading
        controls={
          <div className="head-controls">
            <TaskSortControl onChange={setSort} sort={sort} />
            <TaskFilterControl
              assignees={assigneeChoices}
              filters={activeFilters}
              labels={labelChoices}
              me={meAssigned ? myPerson : undefined}
              onChange={setFilters}
            />
            {onChangeView === undefined ? null : (
              <LayoutControl
                busy={isSavingView}
                onChange={onChangeView}
                view={view}
                views={viewsOf("todos")}
              />
            )}
          </div>
        }
        count={
          filterCount === 0
            ? t("open", { count: openCount })
            : t("openOf", { shown: shownOpen, total: openCount })
        }
        title={t("title")}
      />
      {canEdit && adding !== null ? (
        <TaskForm
          key={eventId}
          eventId={eventId}
          onCancel={closeAdding}
          start={adding}
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
      {filteredTasks.length === 0 && (tasks.length > 0 || !canEdit) ? (
        <EmptyState
          title={tasks.length === 0 ? t("empty") : t("nothingInView")}
        />
      ) : null}
      {filteredTasks.length === 0 && canEdit ? (
        <div className="quick-add-item quick-add-empty">
          <QuickAddTask
            dayLabel={view === "by-day" ? t("noDueDateGroup") : undefined}
            dueOn={null}
            eventId={eventId}
            onDetails={(displayName, dueOn) =>
              setAdding({ displayName, dueOn })
            }
            slots={quickAdd}
          />
        </div>
      ) : null}
      {filteredTasks.length === 0 ? null : (
        <TaskListView
          canEdit={canEdit}
          eventId={eventId}
          labelNames={labels.data?.names}
          manual={sort === "manual"}
          onAddDetails={(displayName, dueOn) =>
            setAdding({ displayName, dueOn })
          }
          onAddSubtask={addSubtask}
          onEdit={setEditingId}
          onRefresh={refresh}
          parents={tree.parents}
          period={period}
          personNames={persons.data?.names}
          progress={tree.progress}
          quickAdd={quickAdd}
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
  const panels = useTranslations("panels");
  const views = useTranslations("views");
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
          {panels("edit")}
        </button>
      ) : null}
      <HistoryButton objectId={item.id} displayName={item.displayName} />
      {canEdit ? <LifecycleButton target={{ ...item, eventId }} /> : null}
    </RowActions>
  );
  // A calendar cell reads the start time alone; the day is the cell's.
  const scheduleRow = (item: EventResponse, mode: RowMode = "full") => (
    <article key={item.id}>
      <DateTile
        dateTime={item.startsOn ?? item.startsAt ?? undefined}
        day={formatEventDatePart(item, "day")}
        month={formatEventDatePart(item, "month")}
      />
      <div className="resource-copy">
        <span className="object-label">{objectTypeLabel("event")}</span>
        <h3>{item.displayName}</h3>
        <p>
          {mode === "cell"
            ? item.startsAt !== null && item.startsOn === null
              ? formatTime(item.startsAt)
              : ""
            : formatEventSchedule(item)}
          {mode !== "cell" && item.location !== null ? (
            <span className="schedule-place">
              <PinIcon className="schedule-place-icon" />
              {item.location}
            </span>
          ) : null}
        </p>
      </div>
      {rowActions(item)}
    </article>
  );
  return (
    <section className="planning-panel">
      <PanelHeading
        controls={
          onChangeView === undefined ? undefined : (
            <LayoutControl
              busy={isSavingView ?? false}
              onChange={onChangeView}
              view={view}
              views={viewsOf("calendar")}
            />
          )
        }
        title={views("calendar")}
      />
      {isAdding && canEdit ? (
        <CreateScheduleDialog
          key={eventId}
          eventId={eventId}
          onClose={() => setIsAdding(false)}
        />
      ) : null}
      {items.length === 0 ? (
        canEdit ? null : (
          <EmptyState title={panels("nothingScheduled")} />
        )
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
                {rowActions(item)}
              </div>
            </li>
          ))}
        </ol>
      ) : view === "week" || view === "month" ? (
        <PeriodView
          period={period}
          placed={placed}
          renderList={(dayItems, mode) => (
            <div className={resourceListClass(mode)}>
              {dayItems.map((item) => scheduleRow(item, mode))}
            </div>
          )}
          undated={unscheduled}
          undatedLabel={panels("unscheduled")}
          view={view}
        />
      ) : (
        <div className="resource-list">
          {items.map((item) => scheduleRow(item))}
        </div>
      )}
      {canEdit ? (
        <div className="quick-add-item">
          <AddRow
            aria-haspopup="dialog"
            label={panels("addScheduleItem")}
            onOpen={() => setIsAdding(true)}
          />
        </div>
      ) : null}
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
  const panels = useTranslations("panels");
  const views = useTranslations("views");
  return (
    <section className="planning-panel">
      <PanelHeading title={views("timeline")} />
      {timeline.items.length === 0 ? (
        <EmptyState title={panels("noTimeline")} />
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
  const panels = useTranslations("panels");
  const views = useTranslations("views");
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
            {panels("edit")}
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
    mode: RowMode,
  ) => (
    <div className={resourceListClass(mode)}>
      {dayExpenses.map(expenseRow)}
      {mode === "full" ? (
        <p className="day-group-sum">
          <span>{panels("dayTotal")}</span>
          {dayTotals(dayExpenses)}
        </p>
      ) : null}
    </div>
  );

  return (
    <section className="planning-panel">
      <PanelHeading
        controls={
          onChangeView === undefined ? undefined : (
            <LayoutControl
              busy={isSavingView ?? false}
              onChange={onChangeView}
              view={view}
              views={viewsOf("expenses")}
            />
          )
        }
        title={views("expenses")}
      />
      {canEdit && isAdding ? (
        <ExpenseForm
          key={eventId}
          eventId={eventId}
          onCancel={() => setIsAdding(false)}
        />
      ) : null}
      {expenses.length === 0 ? (
        canEdit ? null : (
          <EmptyState title={panels("noExpenses")} />
        )
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
          period={period}
          placed={placed}
          renderList={expenseList}
          undated={[]}
          undatedLabel={panels("undated")}
          view={view}
        />
      ) : (
        <div className="resource-list">{expenses.map(expenseRow)}</div>
      )}
      {canEdit ? (
        <div className="quick-add-item">
          <AddRow
            aria-haspopup="dialog"
            label={panels("addExpense")}
            onOpen={() => setIsAdding(true)}
          />
        </div>
      ) : null}
      {totals.length > 0 ? (
        <div className="total-row">
          <span>{panels("totalRecorded")}</span>
          <dl aria-label={panels("totalsByCurrency")} className="money-totals">
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
  const panels = useTranslations("panels");
  const views = useTranslations("views");
  const t = useTranslations("reminderRow");
  // The full editor for a new reminder opens from a quick add row, with
  // what was typed there and the row's instant.
  const [adding, setAdding] = useState<{
    displayName: string;
    remindAt: string;
  } | null>(null);
  const panel = useRef<HTMLElement>(null);
  const returnFocus = useReturnFocusToAddRow(panel);
  const closeAdding = useCallback(() => {
    setAdding(null);
    returnFocus();
  }, [returnFocus]);
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
  const quickAdd = useQuickAddSlots();
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
        t("said.due", {
          name: reminder.displayName,
          day: dayInWords(day, new Date()),
        }),
      ),
    [change, t],
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
      else
        change(
          reminder,
          { rank },
          t("said.moved", { name: reminder.displayName }),
        );
    },
    [byId, change, rowsOf, snooze, t, view],
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
        t("said.position", {
          name: reminder.displayName,
          at: at + direction + 1,
          total: rows.length,
        }),
      );
    };
    const entries: RowMenuEntry[] = canEdit
      ? [
          {
            kind: "action",
            label: t("menu.edit"),
            onSelect: () => setEditingId(reminder.id),
          },
          ...(reminder.status === "pending"
            ? [
                {
                  kind: "action" as const,
                  label: t("menu.dismiss"),
                  onSelect: () =>
                    change(
                      reminder,
                      { status: "dismissed" },
                      t("said.dismissed", { name: reminder.displayName }),
                    ),
                },
              ]
            : []),
          {
            kind: "action",
            label: t("menu.moveUp"),
            disabled: at <= 0,
            onSelect: () => step(-1),
          },
          {
            kind: "action",
            label: t("menu.moveDown"),
            disabled: at < 0 || at >= rows.length - 1,
            onSelect: () => step(1),
          },
          { kind: "rule" },
          {
            kind: "choices",
            label: t("menu.snooze"),
            note: t("snoozeNote", {
              day: dayInWords(day, now),
              time: formatTime(reminder.remindAt),
            }),
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
            label: t("menu.history"),
            onSelect: () =>
              openHistory({
                objectId: reminder.id,
                displayName: reminder.displayName,
              }),
          },
          { kind: "rule" },
          {
            kind: "action",
            label: t("menu.moveToTrash"),
            danger: true,
            onSelect: () => openLifecycle({ ...reminder, eventId }),
          },
        ]
      : [
          {
            kind: "action",
            label: t("menu.history"),
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
        label={t("actionsFor", { name: reminder.displayName })}
      />
    );
  };
  const reminderRow = (
    reminder: ReminderResponse,
    rows: readonly ReminderResponse[],
    groupKey: string,
  ) => (
    <article
      className={rowClasses(
        rowClass(groupKey, reminder.id),
        reminder.status !== "pending",
      )}
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
      </div>
      <StatusChip status={reminder.status} />
      {menu(reminder, rows)}
    </article>
  );
  const reminderList = (
    dayReminders: readonly ReminderResponse[],
    mode: RowMode,
  ) => (
    <div className={resourceListClass(mode)}>
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
    <section className="planning-panel" ref={panel}>
      <PanelHeading
        controls={
          onChangeView === undefined ? undefined : (
            <LayoutControl
              busy={isSavingView ?? false}
              onChange={onChangeView}
              view={view}
              views={viewsOf("reminders")}
            />
          )
        }
        title={views("reminders")}
      />
      {canEdit && adding !== null ? (
        <ReminderForm
          key={eventId}
          eventId={eventId}
          onCancel={closeAdding}
          start={adding}
        />
      ) : null}
      {view === "week" || view === "month" ? null : notice}
      {reminders.length === 0 && !canEdit ? (
        <EmptyState title={panels("noReminders")} />
      ) : null}
      {reminders.length === 0 && canEdit ? (
        <div className="quick-add-item quick-add-empty">
          <QuickAddReminder
            day={null}
            eventId={eventId}
            onDetails={(displayName, remindAt) =>
              setAdding({ displayName, remindAt })
            }
            slots={quickAdd}
          />
        </div>
      ) : null}
      {reminders.length === 0 ? null : view === "by-day" ? (
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
                      onDetails={(displayName, remindAt) =>
                        setAdding({ displayName, remindAt })
                      }
                      slots={quickAdd}
                    />
                  </div>
                ) : null}
              </div>
            </section>
          ))}
        </div>
      ) : view === "week" || view === "month" ? (
        <PeriodView
          notice={notice}
          period={period}
          placed={placed}
          renderList={reminderList}
          undated={[]}
          undatedLabel={panels("undated")}
          view={view}
        />
      ) : (
        <div className="resource-list" {...groupProps("all")}>
          {reminders.map((reminder) => reminderRow(reminder, reminders, "all"))}
          {canEdit ? (
            <div className="quick-add-item">
              <QuickAddReminder
                day={null}
                eventId={eventId}
                onDetails={(displayName, remindAt) =>
                  setAdding({ displayName, remindAt })
                }
                slots={quickAdd}
              />
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
