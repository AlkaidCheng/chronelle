"use client";

import type {
  EventComponentView,
  TaskContext,
  TaskParent,
  TaskProgress,
  TaskResponse,
} from "@chronelle/schemas";
import Link from "next/link";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  type Table,
  useReactTable,
} from "@tanstack/react-table";
import { type ReactNode, useCallback, useMemo, useState } from "react";

import { ErrorNotice } from "../../components/feedback";
import { MonthGrid, PeriodNav, WeekStrip } from "../../components/period-views";
import { CheckIcon } from "../../components/icons";
import { ObjectDetails } from "../../components/object-details";
import { RowActions, StatusChip } from "../events/component-frame";
import { HistoryButton } from "../history/history-button";
import { LifecycleButton } from "../recovery/lifecycle-provider";
import { formatCalendarDate } from "../../lib/event-schedule";
import { formatDateTime, formatTime } from "../../lib/format";
import {
  type DayKey,
  dayKeyOf,
  placeByDay,
  taskDay,
} from "../../lib/day-placement";
import { formatTaskDue } from "../../lib/task-due";
import { groupTasksByDay } from "../../lib/task-groups";
import { nestTasks } from "../../lib/task-tree";
import { useUpdateTask } from "../../lib/queries";

const taskColumn = createColumnHelper<TaskResponse>();

// The renderers of one render, read through the table's meta so the column
// definitions never change: a changed cell definition remounts the cell and
// loses the focus a row's button holds.
interface TaskTableMeta {
  readonly actions: (task: TaskResponse) => ReactNode;
  readonly check: (task: TaskResponse) => ReactNode;
  readonly context: (task: TaskResponse) => ReactNode;
  readonly lineage: (task: TaskResponse, nested: boolean) => ReactNode;
  readonly present: ReadonlySet<string>;
}

function tableMeta(table: Table<TaskResponse>): TaskTableMeta {
  return table.options.meta as TaskTableMeta;
}

const taskColumns = [
  taskColumn.display({
    id: "complete",
    cell: ({ row, table }) => tableMeta(table).check(row.original),
  }),
  taskColumn.accessor("displayName", {
    header: "Task",
    cell: ({ row, table }) => {
      const { context, lineage, present } = tableMeta(table);
      const nested =
        row.original.parentTaskId !== null &&
        present.has(row.original.parentTaskId);
      return (
        <div className={`primary-cell${nested ? " task-nested" : ""}`}>
          <strong>{row.original.displayName}</strong>
          {lineage(row.original, nested)}
          {context(row.original)}
          <ObjectDetails id={row.original.id} />
        </div>
      );
    },
  }),
  taskColumn.display({
    id: "due",
    header: "Due",
    cell: ({ row }) => formatTaskDue(row.original),
  }),
  taskColumn.accessor("status", {
    header: "Status",
    cell: ({ getValue }) => <StatusChip status={getValue()} />,
  }),
  taskColumn.display({
    id: "actions",
    cell: ({ row, table }) => tableMeta(table).actions(row.original),
  }),
];

/**
 * The tasks of one container as a table (list) or grouped by due day, with
 * the same completion check and row actions in both. The container decides
 * which tasks arrive and, when it is an Event, names it so row actions
 * keep their context.
 */
export function TaskListView({
  canEdit,
  contexts,
  eventId,
  labelNames,
  onAddSubtask,
  personNames,
  onEdit,
  onRefresh,
  parents,
  progress,
  tasks,
  view,
}: {
  readonly canEdit: boolean;
  /** The Event each task belongs to, by task ID, when the container spans Events. */
  readonly contexts?: Readonly<Record<string, TaskContext>> | undefined;
  readonly eventId?: string | undefined;
  /** Label names by id; a label the container has not loaded shows nothing. */
  readonly labelNames?: ReadonlyMap<string, string> | undefined;
  /** People's names by id; an assignee the container has not loaded shows nothing. */
  readonly personNames?: ReadonlyMap<string, string> | undefined;
  /** Offers a subtask under a task that has no parent of its own. */
  readonly onAddSubtask?: ((task: TaskResponse) => void) | undefined;
  readonly onEdit: (taskId: string) => void;
  /** Reloads the container after a failed completion change. */
  readonly onRefresh: () => Promise<unknown>;
  /** The parent of each subtask, by subtask ID. */
  readonly parents: Readonly<Record<string, TaskParent>>;
  /** Subtask progress of each parent, by parent ID. */
  readonly progress: Readonly<Record<string, TaskProgress>>;
  readonly tasks: readonly TaskResponse[];
  readonly view: EventComponentView;
}) {
  const ordered = useMemo(() => nestTasks(tasks), [tasks]);
  const present = useMemo(() => new Set(tasks.map((task) => task.id)), [tasks]);
  const lineage = useCallback(
    (task: TaskResponse, nested: boolean) => {
      const count = progress[task.id];
      const parent = parents[task.id];
      const named = task.labelIds.flatMap((id) => {
        const name = labelNames?.get(id);
        return name === undefined ? [] : [{ id, name }];
      });
      const assignee =
        task.assigneeId === null
          ? undefined
          : personNames?.get(task.assigneeId);
      return (
        <>
          {assignee === undefined ? null : (
            <span className="task-assignee">
              <span className="visually-hidden">Assigned to </span>
              {assignee}
            </span>
          )}
          {task.location === null ? null : (
            <span className="task-location">
              <span className="visually-hidden">At </span>
              {task.location}
            </span>
          )}
          {named.length > 0 ? (
            <ul aria-label="Labels" className="task-labels">
              {named.map((label) => (
                <li className="task-label" key={label.id}>
                  {label.name}
                </li>
              ))}
            </ul>
          ) : null}
          {count === undefined ? null : (
            <span className="task-progress">
              <span aria-hidden="true">
                {count.done}/{count.total}
              </span>
              <span className="visually-hidden">
                {count.done} of {count.total} subtasks done
              </span>
            </span>
          )}
          {parent !== undefined && !nested ? (
            <span className="task-parent">Part of {parent.displayName}</span>
          ) : null}
        </>
      );
    },
    [labelNames, parents, personNames, progress],
  );
  const context = useCallback(
    (task: TaskResponse) => {
      const found = contexts?.[task.id];
      return found === undefined ? null : (
        <Link className="task-context" href={`/events/${found.eventId}`}>
          in {found.displayName}
        </Link>
      );
    },
    [contexts],
  );
  const update = useUpdateTask();
  const { mutate: updateTask, isPending: isUpdating } = update;
  const groups = useMemo(
    () => (view === "by-day" ? groupTasksByDay(tasks, new Date()) : []),
    [tasks, view],
  );
  // The period cursor is session state: today whenever the view changes.
  const [period, setPeriod] = useState(() => ({
    view,
    cursor: new Date(),
    selected: null as DayKey | null,
  }));
  if (period.view !== view)
    setPeriod({ view, cursor: new Date(), selected: null });
  const { cursor, selected: selectedDay } = period;
  const setCursor = (cursor: Date, selected: DayKey | null = null) =>
    setPeriod({ view, cursor, selected });
  const setSelectedDay = (selected: DayKey | null) =>
    setPeriod({ view, cursor, selected });
  const placed = useMemo(
    () =>
      view === "week" || view === "month"
        ? placeByDay(tasks, (task) => {
            const day = taskDay(task);
            return day === null ? [] : [day];
          })
        : new Map<DayKey, TaskResponse[]>(),
    [tasks, view],
  );
  const undated = useMemo(
    () =>
      view === "week" || view === "month"
        ? tasks.filter((task) => taskDay(task) === null)
        : [],
    [tasks, view],
  );
  const check = useCallback(
    (task: TaskResponse) => {
      const isDone = task.status === "done";
      return (
        <button
          aria-label={
            isDone
              ? `Reopen ${task.displayName}`
              : `Complete ${task.displayName}`
          }
          className={`task-check${isDone ? " checked" : ""}`}
          disabled={!canEdit || isUpdating}
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
    [canEdit, isUpdating, updateTask],
  );
  const actions = useCallback(
    (task: TaskResponse) => (
      <RowActions>
        {canEdit ? (
          <button
            className="button button-quiet button-small"
            onClick={() => onEdit(task.id)}
            type="button"
          >
            Edit
          </button>
        ) : null}
        {canEdit && onAddSubtask !== undefined && task.parentTaskId === null ? (
          <button
            aria-label={`Add subtask to ${task.displayName}`}
            className="button button-quiet button-small"
            onClick={() => onAddSubtask(task)}
            type="button"
          >
            Add subtask
          </button>
        ) : null}
        <HistoryButton objectId={task.id} displayName={task.displayName} />
        {canEdit ? (
          <LifecycleButton
            target={eventId === undefined ? task : { ...task, eventId }}
          />
        ) : null}
      </RowActions>
    ),
    [canEdit, eventId, onAddSubtask, onEdit],
  );
  const meta = useMemo<TaskTableMeta>(
    () => ({ actions, check, context, lineage, present }),
    [actions, check, context, lineage, present],
  );
  const table = useReactTable({
    columns: taskColumns,
    data: ordered,
    getRowId: (task) => task.id,
    getCoreRowModel: getCoreRowModel(),
    meta,
  });

  const notice = update.isError ? (
    <ErrorNotice
      error={update.error}
      onRefresh={() => void onRefresh().then(() => update.reset())}
    />
  ) : null;
  const row = (task: TaskResponse, showDate: boolean) => (
    <li key={task.id}>
      {check(task)}
      <div className="resource-copy">
        <strong>{task.displayName}</strong>
        {lineage(task, false)}
        {task.dueAt !== null ? (
          <p>
            {showDate ? formatDateTime(task.dueAt) : formatTime(task.dueAt)}
          </p>
        ) : task.dueOn !== null && showDate ? (
          <p>{formatCalendarDate(task.dueOn)}</p>
        ) : null}
        {context(task)}
        <ObjectDetails id={task.id} />
      </div>
      <StatusChip status={task.status} />
      {actions(task)}
    </li>
  );
  const undatedGroup =
    undated.length === 0 ? null : (
      <section aria-label="No due date" className="day-group day-group-plain">
        <h3 className="day-group-heading">
          <span>No due date</span>
        </h3>
        <ul className="resource-list">
          {undated.map((task) => row(task, false))}
        </ul>
      </section>
    );
  if (view === "week")
    return (
      <div className="period-view">
        {notice}
        <PeriodNav cursor={cursor} onChange={setCursor} period="week" />
        <WeekStrip
          cursor={cursor}
          renderDay={(day) => {
            const items = placed.get(day) ?? [];
            return items.length === 0 ? null : (
              <ul className="resource-list resource-list-compact">
                {items.map((task) => row(task, false))}
              </ul>
            );
          }}
        />
        {undatedGroup}
      </div>
    );
  if (view === "month") {
    const shownDay =
      selectedDay ??
      (cursor.getMonth() === new Date().getMonth() &&
      cursor.getFullYear() === new Date().getFullYear()
        ? dayKeyOf(new Date())
        : null);
    const dayTasks = shownDay === null ? [] : (placed.get(shownDay) ?? []);
    return (
      <div className="period-view">
        {notice}
        <PeriodNav cursor={cursor} onChange={setCursor} period="month" />
        <MonthGrid
          cursor={cursor}
          onSelect={setSelectedDay}
          renderItem={(day) =>
            (placed.get(day) ?? []).map((task) => ({
              key: task.id,
              node: (
                <span
                  className={task.status === "done" ? "is-done" : undefined}
                >
                  {task.dueAt !== null ? `${formatTime(task.dueAt)} ` : ""}
                  {task.displayName}
                </span>
              ),
            }))
          }
          selected={shownDay}
        />
        {shownDay === null ? (
          <p className="field-hint">Select a day to see its tasks.</p>
        ) : (
          <section
            aria-label={formatCalendarDate(shownDay)}
            className="day-group day-group-plain"
          >
            <h3 className="day-group-heading">
              <span>{formatCalendarDate(shownDay)}</span>
            </h3>
            {dayTasks.length === 0 ? (
              <p className="field-hint">Nothing due this day.</p>
            ) : (
              <ul className="resource-list">
                {dayTasks.map((task) => row(task, false))}
              </ul>
            )}
          </section>
        )}
        {undatedGroup}
      </div>
    );
  }
  if (view === "by-day")
    return (
      <div className="day-groups">
        {notice}
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
            <ul className="resource-list">
              {group.tasks.map((task) => (
                <li key={task.id}>
                  {check(task)}
                  <div className="resource-copy">
                    <strong>{task.displayName}</strong>
                    {lineage(task, false)}
                    {task.dueAt !== null ? (
                      <p>
                        {group.tone === "overdue"
                          ? formatDateTime(task.dueAt)
                          : formatTime(task.dueAt)}
                      </p>
                    ) : task.dueOn !== null && group.tone === "overdue" ? (
                      <p>{formatCalendarDate(task.dueOn)}</p>
                    ) : null}
                    {context(task)}
                    <ObjectDetails id={task.id} />
                  </div>
                  <StatusChip status={task.status} />
                  {actions(task)}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    );
  return (
    <div className="table-wrap">
      {notice}
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
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
