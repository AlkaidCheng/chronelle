"use client";

import type {
  EventComponentView,
  SectionResponse,
  TaskContext,
  TaskParent,
  TaskProgress,
  TaskResponse,
} from "@chronelle/schemas";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  type Table,
  useReactTable,
} from "@tanstack/react-table";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { type ReactNode, useCallback, useMemo, useState } from "react";

import { DragCard } from "../../components/drag-card";
import { ErrorNotice } from "../../components/feedback";
import { CalendarIcon, CheckIcon, SubtaskIcon } from "../../components/icons";
import type { QuickAddSlots } from "../../components/quick-add-row";
import { RowMenu, type RowMenuEntry } from "../../components/row-menu";
import { tr } from "../../i18n/active-locale";
import {
  rankAtIndex,
  rankBetweenRows,
  rankForStep,
  staysInPlace,
} from "../../lib/collection-order";
import {
  type DayKey,
  dayKeyOf,
  placeByDay,
  taskDay,
} from "../../lib/day-placement";
import {
  dayInWords,
  describeRepeatShort,
  dueShortcuts,
} from "../../lib/due-choices";
import { formatTime } from "../../lib/format";
import { useDuplicateTask, useUpdateTask } from "../../lib/queries";
import { formatCalendarDate } from "../../lib/event-schedule";
import { dueOnDay, formatTaskTime } from "../../lib/task-due";
import { groupBySection } from "../../lib/section-groups";
import { groupTasksByDay } from "../../lib/task-groups";
import { nestTasks } from "../../lib/task-tree";
import type { Period } from "../../lib/use-period";
import { type RowDrop, rowsWithGap, useRowDrag } from "../../lib/use-row-drag";
import { PeriodView, type RowMode } from "../events/period-view";
import { useOpenHistory } from "../history/history-provider";
import { useOpenLifecycle } from "../recovery/lifecycle-provider";
import {
  AddSectionLine,
  DragGrip,
  SectionEditor,
  SectionHead,
  SectionTitle,
} from "../sections/section-parts";
import { useSectionEditing } from "../sections/use-sections";
import { QuickAddTask } from "./quick-add-task";

const taskColumn = createColumnHelper<TaskResponse>();

/** The list's class for a row mode, shared by the containers that render rows. */
export function resourceListClass(mode: RowMode): string {
  return `resource-list${mode === "compact" ? " resource-list-compact" : mode === "cell" ? " resource-list-cell" : ""}`;
}

/** A row's classes: the drag state, is-done for a done row, and the grip's anchor when it holds one. */
export function rowClasses(
  dragClass: string | undefined,
  done: boolean,
  grip = false,
): string | undefined {
  const classes = [
    dragClass,
    done ? "is-done" : undefined,
    grip ? "grip-anchor" : undefined,
  ].filter((name) => name !== undefined);
  return classes.length === 0 ? undefined : classes.join(" ");
}

/** The one group of the list view; by day, groups carry their own keys. */
const listGroup = "all";
/** The group the sections of a sectioned list move within, and the prefix of their row ids. */
const sectionsGroup = "sections";
const sectionRow = "section:";

// The renderers of one render, read through the table's meta so the column
// definitions never change: a changed cell definition remounts the cell and
// loses the focus a row's button holds.
interface TaskTableMeta {
  readonly check: (task: TaskResponse) => ReactNode;
  /** The grip in the gutter at the row's left, when the rows may be moved. */
  readonly grip: (task: TaskResponse) => ReactNode;
  /** The name over its meta line; a row nested under its parent leaves the parent out. */
  readonly copy: (
    task: TaskResponse,
    showDate: boolean,
    nested: boolean,
  ) => ReactNode;
  /** The assignee and the labels, at the row's right. */
  readonly aside: (task: TaskResponse) => ReactNode;
  readonly present: ReadonlySet<string>;
  readonly menu: (
    task: TaskResponse,
    rows: readonly TaskResponse[],
  ) => ReactNode;
  readonly ordered: readonly TaskResponse[];
}

function tableMeta(table: Table<TaskResponse>): TaskTableMeta {
  return table.options.meta as TaskTableMeta;
}

const taskColumns = [
  taskColumn.display({
    id: "complete",
    cell: ({ row, table }) => (
      <>
        {tableMeta(table).grip(row.original)}
        {tableMeta(table).check(row.original)}
      </>
    ),
  }),
  taskColumn.accessor("displayName", {
    header: () => tr("taskRow.columns")("task"),
    cell: ({ row, table }) => {
      const { copy, present } = tableMeta(table);
      const nested =
        row.original.parentTaskId !== null &&
        present.has(row.original.parentTaskId);
      return (
        <div className={`resource-copy${nested ? " task-nested" : ""}`}>
          {copy(row.original, true, nested)}
        </div>
      );
    },
  }),
  taskColumn.display({
    id: "aside",
    header: () => tr("taskRow.columns")("who"),
    cell: ({ row, table }) => tableMeta(table).aside(row.original),
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
  onAddDetails,
  quickAdd,
  sections,
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
  /** Opens the full editor for a new task with what a quick add row typed, its day, and its section. */
  readonly onAddDetails?:
    | ((
        displayName: string,
        dueOn: DayKey | null,
        sectionId: string | null,
      ) => void)
    | undefined;
  /** The state of the quick add rows, owned by the container. */
  readonly quickAdd: QuickAddSlots;
  /** The sections of the Event's To-dos; the list layout groups by them. */
  readonly sections?: readonly SectionResponse[] | undefined;
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
  const t = useTranslations("taskRow");
  const statusLabel = useTranslations("taskRow.status");
  const todos = useTranslations("todos");
  const openHistory = useOpenHistory();
  const openLifecycle = useOpenLifecycle();
  const today = dayKeyOf(new Date());
  /** The name, then one meta line: when it is due (late, today), how far along, how it repeats, where, whose part it is. */
  const copy = useCallback(
    (task: TaskResponse, showDate: boolean, nested: boolean) => {
      const count = progress[task.id];
      const parent = parents[task.id];
      const day = taskDay(task);
      const open = task.status !== "done" && task.status !== "cancelled";
      const when =
        task.dueAt !== null
          ? formatTaskTime(task, showDate)
          : task.dueOn !== null && showDate
            ? formatCalendarDate(task.dueOn)
            : "";
      const repeat = describeRepeatShort(task.repeatRule);
      const tone =
        !open || day === null
          ? ""
          : day < today
            ? " is-late"
            : day === today
              ? " is-today"
              : "";
      const found = contexts?.[task.id];
      const status =
        task.status === "in_progress" || task.status === "cancelled" ? (
          <span className="task-status">{statusLabel(task.status)}</span>
        ) : null;
      const parts: ReactNode[] = [];
      if (when !== "")
        parts.push(
          <span className={`task-due${tone}`} key="due">
            <CalendarIcon />
            {when}
          </span>,
        );
      if (count !== undefined)
        parts.push(
          <span className="task-progress" key="progress">
            <SubtaskIcon />
            <span aria-hidden="true">
              {count.done}/{count.total}
            </span>
            <span className="visually-hidden">
              {t("subtasksDone", { done: count.done, total: count.total })}
            </span>
          </span>,
        );
      if (repeat !== "") parts.push(<span key="repeat">{repeat}</span>);
      if (status !== null) parts.push(<span key="status">{status}</span>);
      if (task.location !== null)
        parts.push(
          <span className="task-location" key="location">
            <span className="visually-hidden">{t("at")}</span>
            {task.location}
          </span>,
        );
      if (parent !== undefined && !nested)
        parts.push(
          <span className="task-parent" key="parent">
            {t("partOf", { parent: parent.displayName })}
          </span>,
        );
      if (found !== undefined)
        parts.push(
          <Link
            className="task-context"
            href={`/events/${found.eventId}`}
            key="context"
          >
            {found.displayName}
          </Link>,
        );
      return (
        <>
          <strong>{task.displayName}</strong>
          {parts.length === 0 ? null : <p className="task-meta">{parts}</p>}
        </>
      );
    },
    [contexts, parents, progress, statusLabel, t, today],
  );
  /** The assignee and the labels, faint at the row's right. */
  const aside = useCallback(
    (task: TaskResponse) => {
      const named = task.labelIds.flatMap((id) => {
        const name = labelNames?.get(id);
        return name === undefined ? [] : [{ id, name }];
      });
      const assignee =
        task.assigneeId === null
          ? undefined
          : personNames?.get(task.assigneeId);
      if (assignee === undefined && named.length === 0) return null;
      return (
        <div className="task-aside">
          {assignee === undefined ? null : (
            <span className="task-assignee">
              <span className="visually-hidden">{t("assignedTo")}</span>
              {assignee}
            </span>
          )}
          {named.length > 0 ? (
            <ul aria-label={t("labels")} className="task-labels">
              {named.map((label) => (
                <li className="task-label" key={label.id}>
                  {label.name}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      );
    },
    [labelNames, personNames, t],
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
  // Open tasks whose day has passed sit in a strip as well as in their day,
  // since the day may be outside the period shown.
  const overdue = useMemo(() => {
    if (view !== "week" && view !== "month") return [];
    const today = dayKeyOf(new Date());
    return tasks.filter((task) => {
      const day = taskDay(task);
      return (
        day !== null &&
        day < today &&
        task.status !== "done" &&
        task.status !== "cancelled"
      );
    });
  }, [tasks, view]);

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
          ? t("said.noDueDate", { name: task.displayName })
          : t("said.due", {
              name: task.displayName,
              day: dayInWords(day, now),
            }),
      );
    },
    [change, t],
  );
  // The list layout of an Event's To-dos groups by section: the loose
  // tasks first, then each section with its own rows and add row.
  const sectioned = sections !== undefined && view === "list";
  const sectionEditing = useSectionEditing(
    eventId ?? "",
    "todos",
    sections ?? [],
    setAnnouncement,
  );
  const bySection = useMemo(
    () => groupBySection(ordered, sections ?? []),
    [ordered, sections],
  );
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
      const task = byId.get(id);
      if (task === undefined) return;
      const rows = drop.rowIds.flatMap((rowId) => byId.get(rowId) ?? []);
      if (sectioned) {
        // A drop names the section by its group; the rank places the task
        // among that section's rows, and both travel in one write.
        const sectionId = drop.groupKey === "" ? null : drop.groupKey;
        const from = task.sectionId ?? "";
        const fromRows =
          from === ""
            ? bySection.loose
            : (bySection.groups.find((group) => group.section.id === from)
                ?.items ?? []);
        if (
          drop.groupKey === from &&
          staysInPlace(fromRows, id, rows, drop.index)
        )
          return;
        change(
          task,
          {
            rank: rankAtIndex(rows, drop.index),
            ...(sectionId !== task.sectionId && { sectionId }),
          },
          t("said.moved", { name: task.displayName }),
        );
        return;
      }
      const from = groupOf.get(id) ?? listGroup;
      if (
        drop.groupKey === from &&
        staysInPlace(rowsOf(from), id, rows, drop.index)
      )
        return;
      const rank = rankAtIndex(rows, drop.index);
      if (drop.groupKey === "undated") {
        if (taskDay(task) !== null) moveToDay(task, null, rank);
        else
          change(task, { rank }, t("said.moved", { name: task.displayName }));
        return;
      }
      if (
        /^\d{4}-\d{2}-\d{2}$/.test(drop.groupKey) &&
        taskDay(task) !== drop.groupKey
      ) {
        moveToDay(task, drop.groupKey, rank);
        return;
      }
      change(task, { rank }, t("said.moved", { name: task.displayName }));
    },
    [
      byId,
      bySection,
      change,
      groupOf,
      moveToDay,
      rowsOf,
      sectionEditing,
      sectioned,
      t,
    ],
  );
  // A section moves among the sections only, a task among the rows only;
  // Overdue keeps its dates, so only its own rows may be reordered there.
  const canDrop = useCallback(
    (groupKey: string, id: string) =>
      id.startsWith(sectionRow)
        ? groupKey === sectionsGroup
        : groupKey !== sectionsGroup &&
          (groupKey !== "overdue" || groupOf.get(id) === "overdue"),
    [groupOf],
  );
  const labelOf = useCallback(
    (id: string) =>
      id.startsWith(sectionRow)
        ? (sections?.find(
            (section) => section.id === id.slice(sectionRow.length),
          )?.name ?? "")
        : (byId.get(id)?.displayName ?? ""),
    [byId, sections],
  );
  const reorder = manual && canEdit;
  const { drag, gapAt, gripProps, groupProps, rootProps, rowClass, rowProps } =
    useRowDrag({
      canDrop,
      enabled: reorder && (view === "list" || view === "by-day"),
      labelOf,
      onDrop,
    });
  const sectionT = useTranslations("sections");
  /** The grip in the gutter at a row's left edge, when the rows may be moved. */
  const grip = useCallback(
    (task: TaskResponse) =>
      reorder && (view === "list" || view === "by-day") ? (
        <DragGrip
          label={sectionT("move", { name: task.displayName })}
          {...gripProps(task.id)}
        />
      ) : null,
    [gripProps, reorder, sectionT, view],
  );

  const check = useCallback(
    (task: TaskResponse) => {
      const isDone = task.status === "done";
      return (
        <button
          aria-label={
            isDone
              ? t("reopen", { name: task.displayName })
              : t("complete", { name: task.displayName })
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
    [canEdit, isUpdating, t, updateTask],
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
          {
            kind: "action",
            label: t("menu.edit"),
            onSelect: () => onEdit(task.id),
          },
          {
            kind: "action",
            label: isDone ? t("menu.reopen") : t("menu.complete"),
            onSelect: () =>
              change(
                task,
                {
                  completedAt: isDone ? null : new Date().toISOString(),
                  status: isDone ? "todo" : "done",
                },
                isDone
                  ? t("said.reopened", { name: task.displayName })
                  : t("said.completed", { name: task.displayName }),
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
              t("said.position", {
                name: task.displayName,
                at: at + 1,
                total: rows.length,
              }),
            );
          };
          const at = rows.findIndex((row) => row.id === task.id);
          entries.push(
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
          );
        }
        entries.push(
          { kind: "rule" },
          {
            kind: "choices",
            label: t("menu.due"),
            note:
              day === null
                ? undefined
                : task.dueAt === null
                  ? t("nowDue", { day: dayInWords(day, now) })
                  : t("nowDueAt", {
                      day: dayInWords(day, now),
                      time: formatTime(task.dueAt),
                    }),
            choices: [
              ...dueShortcuts(now).map((shortcut) => ({
                label: shortcut.label,
                checked: day === shortcut.day,
                onSelect: () => moveToDay(task, shortcut.day),
              })),
              {
                label: t("menu.noDate"),
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
            label: t("menu.addSubtask"),
            onSelect: () => onAddSubtask(task),
          });
        entries.push({
          kind: "action",
          label: t("menu.duplicate"),
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
                  setAnnouncement(
                    t("said.duplicated", { name: task.displayName }),
                  ),
              },
            );
          },
        });
      }
      entries.push(
        {
          kind: "action",
          label: t("menu.copyLink"),
          onSelect: () => {
            const path =
              contextEvent === undefined ? "/tasks" : `/events/${contextEvent}`;
            const link = `${window.location.origin}${path}#task-${task.id}`;
            navigator.clipboard
              ?.writeText(link)
              .then(() => setAnnouncement(t("said.linkCopied")))
              .catch(() => setAnnouncement(t("said.linkNotCopied")));
          },
        },
        {
          kind: "action",
          label: t("menu.history"),
          onSelect: () =>
            openHistory({ objectId: task.id, displayName: task.displayName }),
        },
      );
      if (canEdit)
        entries.push(
          { kind: "rule" },
          {
            kind: "action",
            label: t("menu.moveToTrash"),
            danger: true,
            onSelect: () =>
              openLifecycle(
                eventId === undefined ? task : { ...task, eventId },
              ),
          },
        );
      return (
        <RowMenu
          entries={entries}
          label={t("actionsFor", { name: task.displayName })}
        />
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
      t,
    ],
  );
  const meta = useMemo<TaskTableMeta>(
    () => ({ aside, check, copy, grip, menu, ordered, present }),
    [aside, check, copy, grip, menu, ordered, present],
  );
  const table = useReactTable({
    columns: taskColumns,
    data: ordered,
    getRowId: (task) => task.id,
    getCoreRowModel: getCoreRowModel(),
    meta,
  });

  const error = update.isError
    ? update
    : duplicate.isError
      ? duplicate
      : sectionEditing.error;
  /** The lifted row's line as the card that follows the pointer. */
  const card = () => {
    if (drag === null) return null;
    if (drag.id.startsWith(sectionRow)) {
      const section = sections?.find(
        (candidate) => candidate.id === drag.id.slice(sectionRow.length),
      );
      return section === undefined ? null : (
        <div className="section-head section-head-card">
          <SectionTitle section={section} />
        </div>
      );
    }
    const task = byId.get(drag.id);
    return task === undefined ? null : (
      <div className="row-drag-line">
        {check(task)}
        <div className="resource-copy">{copy(task, true, false)}</div>
        {aside(task)}
      </div>
    );
  };
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
      <DragCard drag={drag}>{card()}</DragCard>
    </>
  );
  const row = (
    task: TaskResponse,
    showDate: boolean,
    rows: readonly TaskResponse[],
    groupKey: string,
  ) => (
    <li
      className={rowClasses(
        rowClass(groupKey, task.id),
        task.status === "done",
        reorder,
      )}
      id={`task-${task.id}`}
      key={task.id}
      {...rowProps(task.id)}
    >
      {grip(task)}
      {check(task)}
      <div className="resource-copy">{copy(task, showDate, false)}</div>
      {aside(task)}
      {menu(task, rows)}
    </li>
  );
  /** The gap a lifted row will fill, among a list's rows. */
  const listGap = (height: number, key: string) => (
    <li aria-hidden="true" className="row-gap" key={key} style={{ height }} />
  );
  const listRows = (
    items: readonly TaskResponse[],
    showDate: boolean,
    groupKey: string,
  ) =>
    rowsWithGap(
      groupKey,
      items,
      drag,
      gapAt,
      (task) => row(task, showDate, items, groupKey),
      listGap,
    );
  if (view === "week" || view === "month")
    return (
      <PeriodView
        notice={notice}
        overdue={overdue}
        period={period}
        placed={placed}
        renderList={(items, mode) => (
          <ul className={resourceListClass(mode)}>
            {items.map((task) => row(task, mode === "full", items, listGroup))}
          </ul>
        )}
        undated={undated}
        undatedLabel={t("groups.noDueDate")}
        view={view}
      />
    );
  if (view === "by-day")
    return (
      <div className="day-groups" {...rootProps()}>
        {notice}
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
            <ul
              className={`resource-list${reorder ? " has-grips" : ""}`}
              {...groupProps(group.key)}
            >
              {listRows(group.tasks, group.tone === "overdue", group.key)}
            </ul>
            {canEdit && group.tone !== "overdue" ? (
              <div className="quick-add-item">
                <QuickAddTask
                  dayLabel={
                    group.key === "undated"
                      ? todos("noDueDateGroup")
                      : group.label[0]
                  }
                  dueOn={group.key === "undated" ? null : group.key}
                  eventId={eventId}
                  onDetails={onAddDetails}
                  slots={quickAdd}
                />
              </div>
            ) : null}
          </section>
        ))}
      </div>
    );
  const header = (
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
  );
  const tableRows = table.getRowModel().rowsById;
  const tableRow = (task: TaskResponse, groupKey: string) => {
    const found = tableRows[task.id];
    if (found === undefined) return null;
    return (
      <tr
        className={rowClasses(
          rowClass(groupKey, task.id),
          task.status === "done",
        )}
        id={`task-${task.id}`}
        key={task.id}
        {...rowProps(task.id)}
      >
        {found.getVisibleCells().map((cell, at) => (
          <td
            className={at === 0 && reorder ? "grip-anchor" : undefined}
            key={cell.id}
          >
            {flexRender(cell.column.columnDef.cell, cell.getContext())}
          </td>
        ))}
      </tr>
    );
  };
  const columns = taskColumns.length;
  /** The gap a lifted row will fill, among a table's rows. */
  const tableGap = (height: number, key: string) => (
    <tr className="row-gap-row" key={key}>
      <td aria-hidden="true" className="row-gap-cell" colSpan={columns}>
        <div className="row-gap-fill" style={{ height }} />
      </td>
    </tr>
  );
  const tableClass = `data-table task-table${reorder ? " has-grips" : ""}`;
  if (!sectioned)
    return (
      <div className="table-wrap" {...rootProps()}>
        {notice}
        <table className={tableClass}>
          {header}
          <tbody {...groupProps(listGroup)}>
            {rowsWithGap(
              listGroup,
              ordered,
              drag,
              gapAt,
              (task) => tableRow(task, listGroup),
              tableGap,
            )}
          </tbody>
        </table>
        {canEdit ? (
          <div className="quick-add-item quick-add-table">
            <QuickAddTask
              dueOn={null}
              eventId={eventId}
              onDetails={onAddDetails}
              slots={quickAdd}
            />
          </div>
        ) : null}
      </div>
    );

  // The loose tasks first, then each section: its head (or its editor),
  // its rows, its own add row, and an Add section line after it; the
  // first Add section line follows the loose tasks.
  const { editing } = sectionEditing;
  const addRow = (section: SectionResponse | null) =>
    canEdit ? (
      <tr>
        <td className="table-add-cell" colSpan={columns}>
          <div className="quick-add-item">
            <QuickAddTask
              dueOn={null}
              eventId={eventId}
              onDetails={onAddDetails}
              sectionId={section?.id ?? null}
              sectionName={section?.name}
              slots={quickAdd}
            />
          </div>
        </td>
      </tr>
    ) : null;
  const addSection = (after: string | null) =>
    canEdit ? (
      <tr>
        <td className="table-add-section-cell" colSpan={columns}>
          {editing?.kind === "add" && editing.after === after ? (
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
          )}
        </td>
      </tr>
    ) : null;
  const sectionGap = (height: number, key: string) => (
    <tbody className="row-gap-row" key={key}>
      <tr>
        <td
          aria-hidden="true"
          className="row-gap-cell section-gap-cell"
          colSpan={columns}
        >
          <div className="row-gap-fill" style={{ height }} />
        </td>
      </tr>
    </tbody>
  );
  const sectionIds = bySection.groups.map(({ section }) => ({
    id: `${sectionRow}${section.id}`,
  }));
  return (
    <div className="table-wrap sectioned-list" {...rootProps()}>
      {notice}
      <table className={tableClass} {...groupProps(sectionsGroup)}>
        {header}
        <tbody data-drop-zone="" {...groupProps("")}>
          {rowsWithGap(
            "",
            bySection.loose,
            drag,
            gapAt,
            (task) => tableRow(task, ""),
            tableGap,
          )}
          {addRow(null)}
          {addSection(null)}
        </tbody>
        {rowsWithGap(
          sectionsGroup,
          sectionIds,
          drag,
          gapAt,
          ({ id }) => {
            const sectionId = id.slice(sectionRow.length);
            const group = bySection.groups.find(
              (candidate) => candidate.section.id === sectionId,
            );
            if (group === undefined) return null;
            const { section, items } = group;
            const at = bySection.groups.indexOf(group);
            const open = items.filter(
              (task) => task.status !== "done" && task.status !== "cancelled",
            ).length;
            return (
              <tbody
                className={`section-body${rowClass(sectionsGroup, id) === undefined ? "" : ` ${rowClass(sectionsGroup, id)}`}`}
                data-drop-zone=""
                data-row-id={id}
                key={id}
                {...groupProps(section.id)}
              >
                <tr>
                  <td className="section-head-cell" colSpan={columns}>
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
                        figure={open}
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
                  </td>
                </tr>
                {rowsWithGap(
                  section.id,
                  items,
                  drag,
                  gapAt,
                  (task) => tableRow(task, section.id),
                  tableGap,
                )}
                {addRow(section)}
                {addSection(section.id)}
              </tbody>
            );
          },
          sectionGap,
        )}
      </table>
    </div>
  );
}
