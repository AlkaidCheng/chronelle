import type {
  EventComponent,
  SectionResponse,
  TaskResponse,
  WeekStart,
} from "@chronelle/schemas";

import { localParts } from "../events/wall-clock";

export const taskViews = ["list", "by-day", "week", "board", "month"] as const;
export type TaskView = (typeof taskViews)[number];

export function taskViewOf(component: EventComponent): TaskView {
  return taskViews.find((view) => view === component.view) ?? "list";
}

export function taskDay(task: TaskResponse, timeZone: string): string | null {
  if (task.dueOn !== null) return task.dueOn;
  return task.dueAt === null ? null : localParts(task.dueAt, timeZone).date;
}

export function todayInZone(timeZone: string, now = new Date()): string {
  return localParts(now.toISOString(), timeZone).date;
}

export function sectionAfterStep(
  sections: readonly SectionResponse[],
  id: string,
  direction: -1 | 1,
): string | null | undefined {
  const index = sections.findIndex((section) => section.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= sections.length) return undefined;
  return direction === -1
    ? (sections[target - 1]?.id ?? null)
    : sections[target]?.id;
}

export function groupTasksBySection(
  items: readonly TaskResponse[],
  sections: readonly SectionResponse[],
) {
  const groups = new Map(
    sections.map((section) => [section.id, [] as TaskResponse[]]),
  );
  const loose: TaskResponse[] = [];
  for (const task of items) {
    const group =
      task.sectionId === null ? undefined : groups.get(task.sectionId);
    if (group === undefined) loose.push(task);
    else group.push(task);
  }
  return {
    loose,
    groups: sections.map((section) => ({
      section,
      items: groups.get(section.id) ?? [],
    })),
  };
}

export function groupTasksByDay(
  items: readonly TaskResponse[],
  timeZone: string,
  today: string,
) {
  const overdue: TaskResponse[] = [];
  const undated: TaskResponse[] = [];
  const dates = new Map<string, TaskResponse[]>();
  const dayKeys = new Map<string, string | null>();
  for (const task of items) {
    const day = taskDay(task, timeZone);
    dayKeys.set(task.id, day);
    if (day === null) {
      undated.push(task);
    } else if (
      day < today &&
      task.status !== "done" &&
      task.status !== "cancelled"
    ) {
      overdue.push(task);
    } else {
      const group = dates.get(day) ?? [];
      group.push(task);
      dates.set(day, group);
    }
  }
  const byDue = (left: TaskResponse, right: TaskResponse) =>
    (dayKeys.get(left.id) ?? "").localeCompare(dayKeys.get(right.id) ?? "") ||
    (left.dueOn === null ? (left.dueAt ?? "") : "").localeCompare(
      right.dueOn === null ? (right.dueAt ?? "") : "",
    );
  return {
    overdue: overdue.sort(byDue),
    dates: [...dates]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([day, tasks]) => ({ day, items: tasks.sort(byDue) })),
    undated,
  };
}

function dayDate(day: string): Date {
  return new Date(`${day}T12:00:00.000Z`);
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(day: string, amount: number): string {
  const date = dayDate(day);
  date.setUTCDate(date.getUTCDate() + amount);
  return dateKey(date);
}

export function weekDays(day: string, weekStart: WeekStart): string[] {
  const weekday = dayDate(day).getUTCDay();
  const offset = (weekday - (weekStart % 7) + 7) % 7;
  const first = addDays(day, -offset);
  return Array.from({ length: 7 }, (_, index) => addDays(first, index));
}

export function monthDays(day: string, weekStart: WeekStart): string[] {
  const date = dayDate(day);
  const first = `${day.slice(0, 7)}-01`;
  const last = dateKey(
    new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)),
  );
  const start = weekDays(first, weekStart)[0] ?? first;
  const end = weekDays(last, weekStart)[6] ?? last;
  const days: string[] = [];
  for (
    let current = start;
    current <= end && days.length < 42;
    current = addDays(current, 1)
  )
    days.push(current);
  return days;
}

export function shiftPeriod(
  day: string,
  view: "week" | "month",
  amount: number,
): string {
  if (view === "week") return addDays(day, amount * 7);
  const date = dayDate(day);
  return dateKey(
    new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + amount, 1)),
  );
}
