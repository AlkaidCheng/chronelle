"use client";

import type {
  EventComponentView,
  EventResponse,
  ExpenseResponse,
  ReminderResponse,
  SectionResponse,
  TaskResponse,
  TimelineResponse,
} from "@chronelle/schemas";
import { useTranslations } from "next-intl";
import { Fragment, useCallback, useMemo, useRef, useState } from "react";
import { DragCard } from "../../components/drag-card";
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
import { useComposerSlots } from "../../lib/composer-slots";
import { groupByDay } from "../../lib/day-groups";
import { groupBySection } from "../../lib/section-groups";
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
  expenseSheet,
  reminderSheet,
  scheduleSheet,
  shownInPeriod,
  taskSheet,
  timelineSheet,
} from "../../lib/export/sheets";
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
  useUpdateExpense,
  useUpdateReminder,
} from "../../lib/queries";
import { instantOnDay } from "../../lib/task-due";
import type { TaskFields } from "../../lib/task-fields";
import { sortTasks, type TaskSort } from "../../lib/task-sort";
import { deriveTaskTree } from "../../lib/task-tree";
import { periodRange, usePeriod } from "../../lib/use-period";
import {
  addRowSelector,
  rowSelector,
  useReturnFocus,
} from "../../lib/use-return-focus";
import { type RowDrop, rowsWithGap, useRowDrag } from "../../lib/use-row-drag";
import { HistoryButton } from "../history/history-button";
import { useOpenHistory } from "../history/history-provider";
import {
  LifecycleButton,
  useOpenLifecycle,
} from "../recovery/lifecycle-provider";
import {
  AddSectionLine,
  DragGrip,
  SectionEditor,
  SectionHead,
  SectionTitle,
} from "../sections/section-parts";
import { useSectionEditing } from "../sections/use-sections";
import { AddTaskRow } from "../tasks/add-task-row";
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
import { ExportControl } from "./export-control";
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

/** A panel's classes: the list column for a list layout, the page for a period grid. */
function panelClasses(view: EventComponentView): string {
  return view === "week" || view === "month"
    ? "planning-panel"
    : "planning-panel panel-column";
}

export function TasksPanel({
  canEdit,
  eventId,
  isSavingView = false,
  onChangeView,
  sections = [],
  tasks,
  view = "list",
}: {
  readonly canEdit: boolean;
  readonly eventId: string;
  readonly isSavingView?: boolean;
  readonly onChangeView?: ((view: EventComponentView) => void) | undefined;
  /** The sections of the Event's To-dos in their order. */
  readonly sections?: readonly SectionResponse[] | undefined;
  readonly tasks: readonly TaskResponse[];
  readonly view?: EventComponentView;
}) {
  const t = useTranslations("todos");
  const controls = useTranslations("controls");
  const exports = useTranslations("export");
  const [filters, setFilters] = useState<TaskFilters>({
    ...defaultTaskFilters,
    timed: false,
    overdue: false,
  });
  const [sort, setSort] = useState<TaskSort>("manual");
  // The full editor for a new task opens from an add row's composer with
  // its fields, and for a task from its row's composer.
  const [adding, setAdding] = useState<Partial<TaskFields> | null>(null);
  const composer = useComposerSlots();
  const panel = useRef<HTMLElement>(null);
  const returnFocus = useReturnFocus(panel);
  const closeAdding = useCallback(() => {
    setAdding(null);
    returnFocus(addRowSelector);
  }, [returnFocus]);
  const [parent, setParent] = useState<SubtaskParent | null>(null);
  const [editing, setEditing] = useState<{
    readonly id: string;
    readonly start: Partial<TaskFields>;
  } | null>(null);
  const closeEditing = useCallback(() => {
    setEditing((current) => {
      if (current !== null) returnFocus(rowSelector(current.id));
      return null;
    });
  }, [returnFocus]);
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
  // The printed page names the sort and the filters the list is read with.
  const shownAs = [
    controls(activeFilters.status),
    ...(activeFilters.timed === true ? [controls("hasTime")] : []),
    ...(activeFilters.overdue === true ? [controls("overdue")] : []),
    ...(activeLabel === "" ? [] : [labels.data?.names.get(activeLabel) ?? ""]),
    ...(activeAssignee === ""
      ? []
      : [persons.data?.names.get(activeAssignee) ?? ""]),
  ].join(", ");

  return (
    <section className={panelClasses(view)} ref={panel}>
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
            <ExportControl
              eventId={eventId}
              panel={panel}
              sheet={(event) =>
                taskSheet(filteredTasks, {
                  event,
                  labels: labels.data?.names,
                  persons: persons.data?.names,
                })
              }
              view="todos"
              viewName={t("title")}
            />
          </div>
        }
        caption={exports("caption", {
          sort: controls(`sorts.${sort}`),
          filter: shownAs,
        })}
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
          sections={sections}
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
          <AddTaskRow
            dayLabel={view === "by-day" ? t("noDueDateGroup") : undefined}
            dueOn={null}
            eventId={eventId}
            onMore={setAdding}
            onRefresh={refresh}
            slots={composer}
          />
        </div>
      ) : null}
      {filteredTasks.length === 0 ? null : (
        <TaskListView
          canEdit={canEdit}
          composer={composer}
          eventId={eventId}
          labelNames={labels.data?.names}
          manual={sort === "manual"}
          onAddDetails={setAdding}
          onAddSubtask={addSubtask}
          onEdit={(id, start) => setEditing({ id, start })}
          onRefresh={refresh}
          parents={tree.parents}
          period={period}
          personNames={persons.data?.names}
          progress={tree.progress}
          sections={sections}
          tasks={filteredTasks}
          view={view}
        />
      )}
      {canEdit && editing !== null ? (
        <TaskInspector
          key={editing.id}
          eventId={eventId}
          onClose={closeEditing}
          sections={sections}
          start={editing.start}
          taskId={editing.id}
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
  const panel = useRef<HTMLElement>(null);
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
    <section className={panelClasses(view)} ref={panel}>
      <PanelHeading
        controls={
          <div className="head-controls">
            {onChangeView === undefined ? null : (
              <LayoutControl
                busy={isSavingView ?? false}
                onChange={onChangeView}
                view={view}
                views={viewsOf("calendar")}
              />
            )}
            <ExportControl
              eventId={eventId}
              panel={panel}
              sheet={() =>
                scheduleSheet(
                  shownInPeriod(
                    items,
                    eventDays,
                    periodRange(view, period.cursor),
                  ),
                )
              }
              view="calendar"
              viewName={views("calendar")}
            />
          </div>
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

/**
 * The event's records in date order. An entry's history is in its row
 * menu, shown on hover or focus, so the list reads as dates and names.
 */
export function TimelinePanel({
  eventId,
  timeline,
}: {
  readonly eventId: string;
  readonly timeline: TimelineResponse;
}) {
  const panels = useTranslations("panels");
  const views = useTranslations("views");
  const openHistory = useOpenHistory();
  const panel = useRef<HTMLElement>(null);
  return (
    <section className="planning-panel panel-column" ref={panel}>
      <PanelHeading
        controls={
          <ExportControl
            eventId={eventId}
            panel={panel}
            sheet={() => timelineSheet(timeline.items)}
            view="timeline"
            viewName={views("timeline")}
          />
        }
        title={views("timeline")}
      />
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
              </div>
              <RowMenu
                entries={[
                  {
                    kind: "action",
                    label: panels("menu.history"),
                    onSelect: () =>
                      openHistory({
                        objectId: item.canonicalObjectId,
                        displayName: item.displayName,
                      }),
                  },
                ]}
                label={panels("actionsFor", { name: item.displayName })}
              />
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

/** The prefix of a section's row id among the rows a drag may lift. */
const sectionRow = "section:";
const sectionsGroup = "sections";

export function ExpensesPanel({
  canEdit,
  eventId,
  expenses,
  isSavingView,
  onChangeView,
  sections = [],
  view = "list",
}: {
  readonly canEdit: boolean;
  readonly eventId: string;
  readonly expenses: readonly ExpenseResponse[];
  readonly isSavingView?: boolean | undefined;
  readonly onChangeView?: ((view: EventComponentView) => void) | undefined;
  /** The sections of the Event's Expenses in their order. */
  readonly sections?: readonly SectionResponse[] | undefined;
  readonly view?: EventComponentView;
}) {
  const panels = useTranslations("panels");
  const views = useTranslations("views");
  const sectionT = useTranslations("sections");
  // The editor for a new expense opens from an add row, in that row's section.
  const [adding, setAdding] = useState<{ sectionId: string | null } | null>(
    null,
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const totals = useMemo(() => sumMoneyByCurrency(expenses), [expenses]);
  const panel = useRef<HTMLElement>(null);
  const period = usePeriod(view);
  const refresh = useRefreshEvent(eventId);
  const update = useUpdateExpense();
  const sectionEditing = useSectionEditing(
    eventId,
    "expenses",
    sections,
    setAnnouncement,
  );
  const byId = useMemo(
    () => new Map(expenses.map((expense) => [expense.id, expense])),
    [expenses],
  );
  const bySection = useMemo(
    () => groupBySection(expenses, sections),
    [expenses, sections],
  );
  const placed = useMemo(
    () =>
      view === "week" || view === "month"
        ? placeByDay(expenses, (expense) => [expenseDay(expense)])
        : new Map<DayKey, ExpenseResponse[]>(),
    [expenses, view],
  );
  // The list and by-day layouts group by section; within a section the
  // rows keep their order by date, or their day groups.
  const sectioned = view === "list" || view === "by-day";
  const dayGroupsOf = useCallback(
    (items: readonly ExpenseResponse[]) =>
      view === "by-day" ? groupByDay(items, expenseDay, new Date()) : [],
    [view],
  );
  // An expense keeps its place by date, so a drop changes only its section;
  // a section's drop places it among the others.
  const onDrop = useCallback(
    (id: string, drop: RowDrop) => {
      if (id.startsWith(sectionRow)) {
        sectionEditing.place(
          id.slice(sectionRow.length),
          drop.rowIds.map((rowId) => rowId.slice(sectionRow.length)),
          drop.index,
        );
        return;
      }
      const expense = byId.get(id);
      if (expense === undefined) return;
      const sectionId = drop.groupKey === "" ? null : drop.groupKey;
      if (sectionId === expense.sectionId) return;
      update.mutate(
        { id, input: { expectedVersion: expense.version, sectionId } },
        {
          onSuccess: () =>
            setAnnouncement(
              sectionT("said.placed", { name: expense.displayName }),
            ),
        },
      );
    },
    [byId, sectionT, sectionEditing, update],
  );
  const canDrop = useCallback(
    (groupKey: string, id: string) =>
      id.startsWith(sectionRow)
        ? groupKey === sectionsGroup
        : groupKey !== sectionsGroup,
    [],
  );
  const labelOf = useCallback(
    (id: string) =>
      id.startsWith(sectionRow)
        ? (sections.find(
            (section) => section.id === id.slice(sectionRow.length),
          )?.name ?? "")
        : (byId.get(id)?.displayName ?? ""),
    [byId, sections],
  );
  const reorder = canEdit && sectioned;
  const { drag, gapAt, gripProps, groupProps, rootProps, rowClass, rowProps } =
    useRowDrag({ canDrop, enabled: reorder, labelOf, onDrop });

  const expenseLine = (expense: ExpenseResponse) => (
    <>
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
    </>
  );
  const expenseRow = (expense: ExpenseResponse, groupKey = "all") => (
    <article
      className={rowClasses(rowClass(groupKey, expense.id), false, reorder)}
      id={`expense-${expense.id}`}
      key={expense.id}
      {...rowProps(expense.id)}
    >
      {reorder ? (
        <DragGrip
          label={sectionT("move", { name: expense.displayName })}
          {...gripProps(expense.id)}
        />
      ) : null}
      {expenseLine(expense)}
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
  const gapRow = (height: number, key: string) => (
    <div aria-hidden="true" className="row-gap" key={key} style={{ height }} />
  );
  // A day's totals by currency, in the heading of a by-day group and under a month's day.
  const moneyTotals = (items: readonly ExpenseResponse[]) => (
    <span className="day-group-totals">
      {sumMoneyByCurrency(items).map(({ amount, currency }) => (
        <span key={currency}>{formatMoney(amount, currency)}</span>
      ))}
    </span>
  );
  const expenseList = (
    dayExpenses: readonly ExpenseResponse[],
    mode: RowMode,
  ) => (
    <div className={resourceListClass(mode)}>
      {dayExpenses.map((expense) => expenseRow(expense))}
      {mode === "full" ? (
        <p className="day-group-sum">
          <span>{panels("dayTotal")}</span>
          {moneyTotals(dayExpenses)}
        </p>
      ) : null}
    </div>
  );
  /**
   * The rows of one section (or the loose ones) as one drop group: a plain
   * list, or by day their day groups, the gap counted across the days.
   */
  const sectionRows = (items: readonly ExpenseResponse[], groupKey: string) => {
    if (view !== "by-day")
      return (
        <div
          className={`resource-list${reorder ? " has-grips" : ""}`}
          {...groupProps(groupKey)}
        >
          {rowsWithGap(
            groupKey,
            items,
            drag,
            gapAt,
            (expense) => expenseRow(expense, groupKey),
            gapRow,
          )}
        </div>
      );
    let index = 0;
    const gap = () => {
      const height = gapAt(groupKey, index);
      return height === null ? null : gapRow(height, `gap:${index}`);
    };
    const days = dayGroupsOf(items).map((group) => (
      <section
        aria-label={group.label.join(", ")}
        className={`day-group day-group-${group.tone}`}
        key={group.key}
      >
        <h3 className="day-group-heading">
          {group.label.map((part) => (
            <span key={part}>{part}</span>
          ))}
          {moneyTotals(group.items)}
        </h3>
        <div className={`resource-list${reorder ? " has-grips" : ""}`}>
          {group.items.map((expense) => {
            if (drag !== null && expense.id === drag.id)
              return expenseRow(expense, groupKey);
            const before = gap();
            index += 1;
            return (
              <Fragment key={expense.id}>
                {before}
                {expenseRow(expense, groupKey)}
              </Fragment>
            );
          })}
        </div>
      </section>
    ));
    return (
      <div className="day-groups section-days" {...groupProps(groupKey)}>
        {days}
        {gap()}
      </div>
    );
  };
  const addRow = (sectionId: string | null) =>
    canEdit ? (
      <div className="quick-add-item">
        <AddRow
          aria-haspopup="dialog"
          label={panels("addExpense")}
          onOpen={() => setAdding({ sectionId })}
        />
      </div>
    ) : null;
  const { editing } = sectionEditing;
  const addSection = (after: string | null) =>
    canEdit ? (
      editing?.kind === "add" && editing.after === after ? (
        <SectionEditor
          busy={sectionEditing.pending}
          onCancel={sectionEditing.cancel}
          onSave={sectionEditing.save}
        />
      ) : (
        <AddSectionLine
          disabled={sectionEditing.pending}
          onOpen={() => sectionEditing.openAdd(after)}
        />
      )
    ) : null;
  const sectionGap = (height: number, key: string) => (
    <div aria-hidden="true" className="section-gap" key={key}>
      <div className="row-gap-fill" style={{ height }} />
    </div>
  );
  const card = () => {
    if (drag === null) return null;
    if (drag.id.startsWith(sectionRow)) {
      const section = sections.find(
        (candidate) => candidate.id === drag.id.slice(sectionRow.length),
      );
      return section === undefined ? null : (
        <div className="section-head section-head-card">
          <SectionTitle section={section} />
        </div>
      );
    }
    const expense = byId.get(drag.id);
    return expense === undefined ? null : (
      <div className="row-drag-line">{expenseLine(expense)}</div>
    );
  };
  const error = update.isError ? update : sectionEditing.error;
  const notice = (
    <>
      {error === null ? null : (
        <ErrorNotice
          error={error.error}
          onRefresh={() => void refresh().then(() => error.reset())}
        />
      )}
      <p aria-live="polite" className="visually-hidden" role="status">
        {announcement}
      </p>
      <DragCard drag={drag}>{card()}</DragCard>
    </>
  );

  return (
    <section className={panelClasses(view)} ref={panel}>
      <PanelHeading
        controls={
          <div className="head-controls">
            {onChangeView === undefined ? null : (
              <LayoutControl
                busy={isSavingView ?? false}
                onChange={onChangeView}
                view={view}
                views={viewsOf("expenses")}
              />
            )}
            <ExportControl
              eventId={eventId}
              panel={panel}
              sheet={() =>
                expenseSheet(
                  sectioned
                    ? [
                        bySection.loose,
                        ...bySection.groups.map((group) => group.items),
                      ].flatMap((items) =>
                        view === "by-day"
                          ? dayGroupsOf(items).flatMap((group) => group.items)
                          : items,
                      )
                    : shownInPeriod(
                        expenses,
                        (expense) => [expenseDay(expense)],
                        periodRange(view, period.cursor),
                      ),
                )
              }
              view="expenses"
              viewName={views("expenses")}
            />
          </div>
        }
        title={views("expenses")}
      />
      {canEdit && adding !== null ? (
        <ExpenseForm
          key={eventId}
          eventId={eventId}
          onCancel={() => setAdding(null)}
          sections={sections}
          startSectionId={adding.sectionId}
        />
      ) : null}
      {sectioned ? notice : null}
      {expenses.length === 0 && sections.length === 0 && !canEdit ? (
        <EmptyState title={panels("noExpenses")} />
      ) : null}
      {sectioned ? (
        <div className="sectioned-list" {...rootProps()}>
          <div data-drop-zone="">
            {sectionRows(bySection.loose, "")}
            {addRow(null)}
          </div>
          {addSection(null)}
          <div {...groupProps(sectionsGroup)}>
            {rowsWithGap(
              sectionsGroup,
              bySection.groups.map(({ section }) => ({
                id: `${sectionRow}${section.id}`,
              })),
              drag,
              gapAt,
              ({ id }) => {
                const group = bySection.groups.find(
                  (candidate) =>
                    candidate.section.id === id.slice(sectionRow.length),
                );
                if (group === undefined) return null;
                const { section, items } = group;
                const at = bySection.groups.indexOf(group);
                const lifted = rowClass(sectionsGroup, id);
                return (
                  <section
                    aria-label={section.name}
                    className={`list-section${lifted === undefined ? "" : ` ${lifted}`}`}
                    data-drop-zone=""
                    data-row-id={id}
                    key={id}
                  >
                    {editing?.kind === "edit" && editing.id === section.id ? (
                      <SectionEditor
                        busy={sectionEditing.pending}
                        onCancel={sectionEditing.cancel}
                        onSave={sectionEditing.save}
                        section={section}
                      />
                    ) : (
                      <SectionHead
                        canEdit={canEdit}
                        figure={items.length === 0 ? null : moneyTotals(items)}
                        grip={
                          reorder ? (
                            <DragGrip
                              className="section-head-grip"
                              label={sectionT("moveSection", {
                                name: section.name,
                              })}
                              {...gripProps(id)}
                            />
                          ) : null
                        }
                        isFirst={at === 0}
                        isLast={at === bySection.groups.length - 1}
                        onDelete={() => sectionEditing.destroy(section.id)}
                        onEdit={() => sectionEditing.openEdit(section.id)}
                        onMove={(direction) =>
                          sectionEditing.move(section.id, direction)
                        }
                        section={section}
                      />
                    )}
                    {sectionRows(items, section.id)}
                    {addRow(section.id)}
                    {addSection(section.id)}
                  </section>
                );
              },
              sectionGap,
            )}
          </div>
        </div>
      ) : (
        <>
          {expenses.length === 0 ||
          (view !== "week" && view !== "month") ? null : (
            <PeriodView
              period={period}
              placed={placed}
              renderList={expenseList}
              undated={[]}
              undatedLabel={panels("undated")}
              view={view}
            />
          )}
          {addRow(null)}
        </>
      )}
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
          sections={sections}
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
  const returnFocus = useReturnFocus(panel);
  const closeAdding = useCallback(() => {
    setAdding(null);
    returnFocus(addRowSelector);
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
  const reorder = canEdit && (view === "list" || view === "by-day");
  const { drag, gapAt, gripProps, groupProps, rootProps, rowClass, rowProps } =
    useRowDrag({
      enabled: reorder,
      labelOf,
      onDrop,
    });
  const sectionT = useTranslations("sections");
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
        reorder,
      )}
      id={`reminder-${reminder.id}`}
      key={reminder.id}
      {...rowProps(reminder.id)}
    >
      {reorder ? (
        <DragGrip
          label={sectionT("move", { name: reminder.displayName })}
          {...gripProps(reminder.id)}
        />
      ) : null}
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
      <DragCard drag={drag}>
        {drag === null ? null : (byId.get(drag.id)?.displayName ?? "")}
      </DragCard>
    </>
  );
  /** The gap a lifted reminder will fill, among a list's rows. */
  const gapRow = (height: number, key: string) => (
    <div aria-hidden="true" className="row-gap" key={key} style={{ height }} />
  );

  return (
    <section className={panelClasses(view)} ref={panel}>
      <PanelHeading
        controls={
          <div className="head-controls">
            {onChangeView === undefined ? null : (
              <LayoutControl
                busy={isSavingView ?? false}
                onChange={onChangeView}
                view={view}
                views={viewsOf("reminders")}
              />
            )}
            <ExportControl
              eventId={eventId}
              panel={panel}
              sheet={() =>
                reminderSheet(
                  view === "by-day"
                    ? groups.flatMap((group) => group.items)
                    : shownInPeriod(
                        reminders,
                        (reminder) => [reminderDay(reminder)],
                        periodRange(view, period.cursor),
                      ),
                )
              }
              view="reminders"
              viewName={views("reminders")}
            />
          </div>
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
        <div className="day-groups" {...rootProps()}>
          {groups.map((group) => (
            <section
              aria-label={group.label.join(", ")}
              className={`day-group day-group-${group.tone}`}
              data-drop-zone=""
              key={group.key}
            >
              <h3 className="day-group-heading">
                {group.label.map((part) => (
                  <span key={part}>{part}</span>
                ))}
              </h3>
              <div
                className={`resource-list${reorder ? " has-grips" : ""}`}
                {...groupProps(group.key)}
              >
                {rowsWithGap(
                  group.key,
                  group.items,
                  drag,
                  gapAt,
                  (reminder) => reminderRow(reminder, group.items, group.key),
                  gapRow,
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
        <div
          className={`resource-list${reorder ? " has-grips" : ""}`}
          {...rootProps()}
          {...groupProps("all")}
        >
          {rowsWithGap(
            "all",
            reminders,
            drag,
            gapAt,
            (reminder) => reminderRow(reminder, reminders, "all"),
            gapRow,
          )}
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
