"use client";

import type { TaskListQuery } from "@chronelle/schemas";

import { HeadMenu, type HeadMenuEntry } from "../../components/head-menu";
import { FilterIcon, SortIcon } from "../../components/icons";
import { type TaskSort, taskSorts } from "../../lib/task-sort";

export type TaskStatusFilter = NonNullable<TaskListQuery["filter"]>;

/** What a task collection filters by; the status is the server's, the rest narrow further. */
export interface TaskFilters {
  readonly status: TaskStatusFilter;
  readonly label: string;
  readonly assignee: string;
  /** Only tasks due at a time; offered when the container holds every task. */
  readonly timed?: boolean | undefined;
  /** Only open tasks whose due has passed; offered when the container holds every task. */
  readonly overdue?: boolean | undefined;
}

export const defaultTaskFilters: TaskFilters = {
  status: "open",
  label: "",
  assignee: "",
};

/** How many choices differ from the defaults: what the Filter button counts. */
export function activeFilterCount(filters: TaskFilters): number {
  return (
    Number(filters.status !== "open") +
    Number(filters.label !== "") +
    Number(filters.assignee !== "") +
    Number(filters.timed === true) +
    Number(filters.overdue === true)
  );
}

/** Sort as one quiet control; the button reads the chosen order when it is not the default. */
export function TaskSortControl({
  defaultSort = "due",
  onChange,
  sort,
}: {
  readonly defaultSort?: TaskSort;
  readonly onChange: (sort: TaskSort) => void;
  readonly sort: TaskSort;
}) {
  return (
    <HeadMenu
      active={sort !== defaultSort}
      entries={taskSorts.map((choice) => ({
        kind: "radio",
        label: choice.label,
        checked: choice.value === sort,
        onSelect: () => {
          if (choice.value !== sort) onChange(choice.value);
        },
      }))}
      icon={<SortIcon />}
      label="Sort"
      name={
        sort === defaultSort
          ? undefined
          : taskSorts.find((choice) => choice.value === sort)?.label
      }
    />
  );
}

/**
 * Filter as one quiet control over the status (Open, All, Done), the
 * client-side toggles a container offers, and the labels and people the
 * container knows. Choices keep the menu open; the button counts them.
 */
export function TaskFilterControl({
  assignees,
  filters,
  labels,
  me,
  onChange,
}: {
  /** The people offered by name, the signed-in user's own person left out. */
  readonly assignees: readonly { readonly id: string; readonly name: string }[];
  readonly filters: TaskFilters;
  readonly labels: readonly { readonly id: string; readonly name: string }[];
  /** The signed-in user's person, offered as Me. */
  readonly me?: { readonly id: string } | undefined;
  readonly onChange: (filters: TaskFilters) => void;
}) {
  const count = activeFilterCount(filters);
  const radio = (
    label: string,
    checked: boolean,
    change: Partial<TaskFilters>,
  ): HeadMenuEntry => ({
    kind: "radio",
    label,
    checked,
    closes: false,
    onSelect: () => onChange({ ...filters, ...change }),
  });
  const entries: HeadMenuEntry[] = [
    { kind: "label", text: "Show" },
    radio("Open", filters.status === "open", { status: "open" }),
    radio("All", filters.status === "all", { status: "all" }),
    radio("Done", filters.status === "done", { status: "done" }),
  ];
  if (filters.timed !== undefined)
    entries.push({
      kind: "check",
      label: "Has a time",
      checked: filters.timed,
      onSelect: () => onChange({ ...filters, timed: !filters.timed }),
    });
  if (filters.overdue !== undefined)
    entries.push({
      kind: "check",
      label: "Overdue",
      checked: filters.overdue,
      onSelect: () => onChange({ ...filters, overdue: !filters.overdue }),
    });
  if (labels.length > 0)
    entries.push(
      { kind: "rule" },
      { kind: "label", text: "Label" },
      radio("Any label", filters.label === "", { label: "" }),
      ...labels.map((label) =>
        radio(label.name, filters.label === label.id, { label: label.id }),
      ),
    );
  if (me !== undefined || assignees.length > 0)
    entries.push(
      { kind: "rule" },
      { kind: "label", text: "Assignee" },
      radio("Anyone", filters.assignee === "", { assignee: "" }),
      ...(me === undefined
        ? []
        : [radio("Me", filters.assignee === me.id, { assignee: me.id })]),
      ...assignees.map((person) =>
        radio(person.name, filters.assignee === person.id, {
          assignee: person.id,
        }),
      ),
    );
  entries.push(
    { kind: "rule" },
    {
      kind: "item",
      label: "Clear filters",
      onSelect: () =>
        onChange({
          ...defaultTaskFilters,
          ...(filters.timed === undefined ? {} : { timed: false }),
          ...(filters.overdue === undefined ? {} : { overdue: false }),
        }),
    },
  );
  return (
    <HeadMenu
      active={count > 0}
      entries={entries}
      icon={<FilterIcon />}
      label="Filter"
      name={
        count === 0
          ? undefined
          : `${count} ${count === 1 ? "filter" : "filters"}`
      }
    />
  );
}
