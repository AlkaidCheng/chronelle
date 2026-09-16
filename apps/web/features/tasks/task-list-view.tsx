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
import { CheckIcon } from "../../components/icons";
import { ObjectDetails } from "../../components/object-details";
import { RowMenu, type RowMenuEntry } from "../../components/row-menu";
import { StatusChip } from "../events/component-frame";
import { useOpenHistory } from "../history/history-provider";
import { useOpenLifecycle } from "../recovery/lifecycle-provider";
import {
  rankAtIndex,
  rankBetweenRows,
  rankForStep,
  staysInPlace,
} from "../../lib/collection-order";
import { formatTime } from "../../lib/format";
import { type DayKey, placeByDay, taskDay } from "../../lib/day-placement";
import { dayInWords, dueShortcuts } from "../../lib/due-choices";
import type { Period } from "../../lib/use-period";
import { PeriodView } from "../events/period-view";
import { dueOnDay, formatTaskDue, formatTaskWhen } from "../../lib/task-due";
import { groupTasksByDay } from "../../lib/task-groups";
import { nestTasks } from "../../lib/task-tree";
import { useDuplicateTask, useUpdateTask } from "../../lib/queries";
import { type RowDrop, useRowDrag } from "../../lib/use-row-drag";
import { QuickAddTask } from "./quick-add-task";

const taskColumn = createColumnHelper<TaskResponse>();

/** The one group of the list view; by day, groups carry their own keys. */
const listGroup = "all";

// The renderers of one render, read through the table's meta so the column
// definitions never change: a changed cell definition remounts the cell and
// loses the focus a row's button holds.
interface TaskTableMeta {
  readonly check: (task: TaskResponse) => ReactNode;
  readonly context: (task: TaskResponse) => ReactNode;
  readonly lineage: (task: TaskResponse, nested: boolean) => ReactNode;
  readonly menu: (
    task: TaskResponse,
    rows: readonly TaskResponse[],
  ) => ReactNode;
  readonly ordered: readonly TaskResponse[];
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
    cell: ({ row, table }) => {
      const { menu, ordered } = tableMeta(table);
      return menu(row.original, ordered);
    },
  }),
];

/**
 * The tasks of one container as a table (list) or grouped by due day, with
 * the same completion check and row menu in both. The container decides
 * which tasks arrive and, when it is an Event, names it so row actions
 * keep their context. Under manual order a row can be dragged to another
 * place or day, or moved a step from its menu.
 */
export function TaskListView({
  canEdit,
  contexts,
  eventId,
  labelNames,
  manual = false,
  onAddSubtask,
  personNames,
  onEdit,
  onRefresh,
  parents,
  period,
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
  /** The tasks arrive in manual order, so they may be reordered. */
  readonly manual?: boolean | undefined;
  /** People's names by id; an assignee the container has not loaded shows nothing. */
  readonly personNames?: ReadonlyMap<string, string> | undefined;
  /** Offers a subtask under a task that has no parent of its own. */
  readonly onAddSubtask?: ((task: TaskResponse) => void) | undefined;
  readonly onEdit: (taskId: string) => void;
  /** Reloads the container after a failed change. */
  readonly onRefresh: () => Promise<unknown>;
  /** The parent of each subtask, by subtask ID. */
  readonly parents: Readonly<Record<string, TaskParent>>;
  /** The period the week and month views show, owned by the container. */
  readonly period: Period;
  /** Subtask progress of each parent, by parent ID. */
  readonly progress: Readonly<Record<string, TaskProgress>>;
  readonly tasks: readonly TaskResponse[];
  readonly view: EventComponentView;
}) {
  const ordered = useMemo(() => nestTasks(tasks), [tasks]);
  const present = useMemo(() => new Set(tasks.map((task) => task.id)), [tasks]);
  const byId = useMemo(
    () => new Map(tasks.map((task) => [task.id, task])),
    [tasks],
  );
  const [announcement, setAnnouncement] = useState("");
  const openHistory = useOpenHistory();
  const openLifecycle = useOpenLifecycle();
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
  const duplicate = useDuplicateTask();
  const { mutate: updateTask, isPending: isUpdating } = update;
  const { mutate: duplicateTask } = duplicate;
  const groups = useMemo(
    () =>
      view === "by-day"
        ? groupTasksByDay(tasks, new Date(), manual ? "manual" : "due")
        : [],
    [manual, tasks, view],
  );
  // Which group each task sits in, for a drop that keeps its place or a
  // step that stays among its rows.
  const groupOf = useMemo(() => {
    const keys = new Map<string, string>();
    if (view === "by-day")
      for (const group of groups)
        for (const task of group.tasks) keys.set(task.id, group.key);
    else for (const task of ordered) keys.set(task.id, listGroup);
    return keys;
  }, [groups, ordered, view]);
  const rowsOf = useCallback(
    (groupKey: string): readonly TaskResponse[] =>
      groupKey === listGroup
        ? ordered
        : (groups.find((group) => group.key === groupKey)?.tasks ?? []),
    [groups, ordered],
  );
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

  /** One versioned update of the task with the given changes, announced. */
  const change = useCallback(
    (task: TaskResponse, input: Record<string, unknown>, said: string) => {
      updateTask(
        { id: task.id, input: { expectedVersion: task.version, ...input } },
        { onSuccess: () => setAnnouncement(said) },
      );
    },
    [updateTask],
  );
  const moveToDay = useCallback(
    (task: TaskResponse, day: DayKey | null, rank?: string) => {
      const now = new Date();
      change(
        task,
        { ...dueOnDay(task, day), ...(rank === undefined ? {} : { rank }) },
        day === null
          ? `${task.displayName} has no due date now.`
          : `${task.displayName} is due ${dayInWords(day, now)}.`,
      );
    },
    [change],
  );
  const onDrop = useCallback(
    (id: string, drop: RowDrop) => {
      const task = byId.get(id);
      if (task === undefined) return;
      const from = groupOf.get(id) ?? listGroup;
      const rows = drop.rowIds.flatMap((rowId) => byId.get(rowId) ?? []);
      if (
        drop.groupKey === from &&
        staysInPlace(rowsOf(from), id, rows, drop.index)
      )
        return;
      const rank = rankAtIndex(rows, drop.index);
      if (drop.groupKey === "undated") {
        if (taskDay(task) !== null) moveToDay(task, null, rank);
        else change(task, { rank }, `${task.displayName} moved.`);
        return;
      }
      if (
        /^\d{4}-\d{2}-\d{2}$/.test(drop.groupKey) &&
        taskDay(task) !== drop.groupKey
      ) {
        moveToDay(task, drop.groupKey, rank);
        return;
      }
      change(task, { rank }, `${task.displayName} moved.`);
    },
    [byId, change, groupOf, moveToDay, rowsOf],
  );
  // Overdue keeps its dates: only its own rows may be reordered there.
  const canDrop = useCallback(
    (groupKey: string, id: string) =>
      groupKey !== "overdue" || groupOf.get(id) === "overdue",
    [groupOf],
  );
  const labelOf = useCallback(
    (id: string) => byId.get(id)?.displayName ?? "",
    [byId],
  );
  const reorder = manual && canEdit;
  const { drag, groupProps, rowClass, rowProps } = useRowDrag({
    canDrop,
    enabled: reorder && (view === "list" || view === "by-day"),
    labelOf,
    onDrop,
  });

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
          <CheckIcon />
        </button>
      );
    },
    [canEdit, isUpdating, updateTask],
  );
  const menu = useCallback(
    (task: TaskResponse, rows: readonly TaskResponse[]) => {
      const isDone = task.status === "done";
      const now = new Date();
      const day = taskDay(task);
      const contextEvent = eventId ?? contexts?.[task.id]?.eventId;
      const entries: RowMenuEntry[] = [];
      if (canEdit) {
        entries.push(
          { kind: "action", label: "Edit", onSelect: () => onEdit(task.id) },
          {
            kind: "action",
            label: isDone ? "Reopen" : "Complete",
            onSelect: () =>
              change(
                task,
                {
                  completedAt: isDone ? null : new Date().toISOString(),
                  status: isDone ? "todo" : "done",
                },
                isDone
                  ? `${task.displayName} reopened.`
                  : `${task.displayName} completed.`,
              ),
          },
        );
        if (reorder) {
          const step = (direction: -1 | 1) => {
            const rank = rankForStep(rows, task.id, direction);
            if (rank === null) return;
            const at = rows.findIndex((row) => row.id === task.id) + direction;
            change(
              task,
              { rank },
              `${task.displayName} is now ${at + 1} of ${rows.length}.`,
            );
          };
          const at = rows.findIndex((row) => row.id === task.id);
          entries.push(
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
          );
        }
        entries.push(
          { kind: "rule" },
          {
            kind: "choices",
            label: "Due",
            note:
              day === null
                ? undefined
                : `Now ${dayInWords(day, now)}${
                    task.dueAt === null ? "" : `, ${formatTime(task.dueAt)}`
                  }`,
            choices: [
              ...dueShortcuts(now).map((shortcut) => ({
                label: shortcut.label,
                checked: day === shortcut.day,
                onSelect: () => moveToDay(task, shortcut.day),
              })),
              {
                label: "No date",
                checked: day === null,
                onSelect: () => {
                  if (day !== null) moveToDay(task, null);
                },
              },
            ],
          },
          { kind: "rule" },
        );
        if (onAddSubtask !== undefined && task.parentTaskId === null)
          entries.push({
            kind: "action",
            label: "Add subtask",
            onSelect: () => onAddSubtask(task),
          });
        entries.push({
          kind: "action",
          label: "Duplicate",
          onSelect: () => {
            const at = rows.findIndex((row) => row.id === task.id);
            duplicateTask(
              {
                eventId: contextEvent,
                rank: rankBetweenRows(task, rows[at + 1]),
                task,
              },
              {
                onSuccess: () =>
                  setAnnouncement(`Duplicated ${task.displayName}.`),
              },
            );
          },
        });
      }
      entries.push(
        {
          kind: "action",
          label: "Copy link",
          onSelect: () => {
            const path =
              contextEvent === undefined ? "/tasks" : `/events/${contextEvent}`;
            const link = `${window.location.origin}${path}#task-${task.id}`;
            navigator.clipboard
              ?.writeText(link)
              .then(() => setAnnouncement("Link copied."))
              .catch(() => setAnnouncement("The link could not be copied."));
          },
        },
        {
          kind: "action",
          label: "History",
          onSelect: () =>
            openHistory({ objectId: task.id, displayName: task.displayName }),
        },
      );
      if (canEdit)
        entries.push(
          { kind: "rule" },
          {
            kind: "action",
            label: "Move to Trash",
            danger: true,
            onSelect: () =>
              openLifecycle(
                eventId === undefined ? task : { ...task, eventId },
              ),
          },
        );
      return (
        <RowMenu entries={entries} label={`Actions for ${task.displayName}`} />
      );
    },
    [
      canEdit,
      change,
      contexts,
      duplicateTask,
      eventId,
      moveToDay,
      onAddSubtask,
      onEdit,
      openHistory,
      openLifecycle,
      reorder,
    ],
  );
  const meta = useMemo<TaskTableMeta>(
    () => ({ check, context, lineage, menu, ordered, present }),
    [check, context, lineage, menu, ordered, present],
  );
  const table = useReactTable({
    columns: taskColumns,
    data: ordered,
    getRowId: (task) => task.id,
    getCoreRowModel: getCoreRowModel(),
    meta,
  });

  const error = update.isError ? update : duplicate.isError ? duplicate : null;
  const notice = (
    <>
      {error === null ? null : (
        <ErrorNotice
          error={error.error}
          onRefresh={() => void onRefresh().then(() => error.reset())}
        />
      )}
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
  const row = (
    task: TaskResponse,
    showDate: boolean,
    rows: readonly TaskResponse[],
    groupKey: string,
  ) => (
    <li
      className={rowClass(groupKey, task.id)}
      id={`task-${task.id}`}
      key={task.id}
      {...rowProps(task.id)}
    >
      {check(task)}
      <div className="resource-copy">
        <strong>{task.displayName}</strong>
        {lineage(task, false)}
        {formatTaskWhen(task, showDate) !== "" ? (
          <p>{formatTaskWhen(task, showDate)}</p>
        ) : null}
        {context(task)}
        <ObjectDetails id={task.id} />
      </div>
      <StatusChip status={task.status} />
      {menu(task, rows)}
    </li>
  );
  if (view === "week" || view === "month")
    return (
      <PeriodView
        cellOf={(task) => (
          <span className={task.status === "done" ? "is-done" : undefined}>
            {task.dueAt !== null ? `${formatTime(task.dueAt)} ` : ""}
            {task.displayName}
          </span>
        )}
        emptyDay="Nothing due this day."
        notice={notice}
        period={period}
        placed={placed}
        renderList={(items, compact) => (
          <ul
            className={`resource-list${compact ? " resource-list-compact" : ""}`}
          >
            {items.map((task) => row(task, false, items, listGroup))}
          </ul>
        )}
        undated={undated}
        undatedLabel="No due date"
        view={view}
      />
    );
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
            <ul className="resource-list" {...groupProps(group.key)}>
              {group.tasks.map((task) =>
                row(task, group.tone === "overdue", group.tasks, group.key),
              )}
            </ul>
            {canEdit && group.tone !== "overdue" ? (
              <div className="quick-add-item">
                <QuickAddTask
                  dayLabel={
                    group.key === "undated" ? "no due date" : group.label[0]
                  }
                  dueOn={group.key === "undated" ? null : group.key}
                  eventId={eventId}
                />
              </div>
            ) : null}
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
        <tbody {...groupProps(listGroup)}>
          {table.getRowModel().rows.map((tableRow) => (
            <tr
              className={rowClass(listGroup, tableRow.id)}
              id={`task-${tableRow.id}`}
              key={tableRow.id}
              {...rowProps(tableRow.id)}
            >
              {tableRow.getVisibleCells().map((cell) => (
                <td key={cell.id}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {canEdit ? (
        <div className="quick-add-item quick-add-table">
          <QuickAddTask dueOn={null} eventId={eventId} />
        </div>
      ) : null}
    </div>
  );
}
