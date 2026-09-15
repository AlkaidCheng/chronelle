"use client";

import type {
  EventComponentView,
  TaskContext,
  TaskResponse,
} from "@chronelle/schemas";
import Link from "next/link";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useCallback, useMemo } from "react";

import { ErrorNotice } from "../../components/feedback";
import { CheckIcon } from "../../components/icons";
import { ObjectDetails } from "../../components/object-details";
import { RowActions, StatusChip } from "../events/component-frame";
import { HistoryButton } from "../history/history-button";
import { LifecycleButton } from "../recovery/lifecycle-provider";
import { formatCalendarDate } from "../../lib/event-schedule";
import { formatDateTime, formatTime } from "../../lib/format";
import { formatTaskDue } from "../../lib/task-due";
import { groupTasksByDay } from "../../lib/task-groups";
import { useUpdateTask } from "../../lib/queries";

const taskColumn = createColumnHelper<TaskResponse>();

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
  onEdit,
  onRefresh,
  tasks,
  view,
}: {
  readonly canEdit: boolean;
  /** The Event each task belongs to, by task ID, when the container spans Events. */
  readonly contexts?: Readonly<Record<string, TaskContext>> | undefined;
  readonly eventId?: string | undefined;
  readonly onEdit: (taskId: string) => void;
  /** Reloads the container after a failed completion change. */
  readonly onRefresh: () => Promise<unknown>;
  readonly tasks: readonly TaskResponse[];
  readonly view: EventComponentView;
}) {
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
        <HistoryButton objectId={task.id} displayName={task.displayName} />
        {canEdit ? (
          <LifecycleButton
            target={eventId === undefined ? task : { ...task, eventId }}
          />
        ) : null}
      </RowActions>
    ),
    [canEdit, eventId, onEdit],
  );
  const columns = useMemo(
    () => [
      taskColumn.display({
        id: "complete",
        cell: ({ row }) => check(row.original),
      }),
      taskColumn.accessor("displayName", {
        header: "Task",
        cell: ({ row }) => (
          <div className="primary-cell">
            <strong>{row.original.displayName}</strong>
            {context(row.original)}
            <ObjectDetails id={row.original.id} />
          </div>
        ),
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
        cell: ({ row }) => actions(row.original),
      }),
    ],
    [actions, check, context],
  );
  const table = useReactTable({
    columns,
    data: tasks as TaskResponse[],
    getRowId: (task) => task.id,
    getCoreRowModel: getCoreRowModel(),
  });

  const notice = update.isError ? (
    <ErrorNotice
      error={update.error}
      onRefresh={() => void onRefresh().then(() => update.reset())}
    />
  ) : null;
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
