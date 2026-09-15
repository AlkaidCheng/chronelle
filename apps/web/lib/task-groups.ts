import type { TaskResponse } from "@chronelle/schemas";

export interface TaskDayGroup {
  readonly key: string;
  /** The heading's parts: a date, then Today or Tomorrow, then the weekday. */
  readonly label: readonly string[];
  readonly tone: "overdue" | "today" | "plain";
  readonly tasks: readonly TaskResponse[];
}

const overdueKey = "overdue";
const undatedKey = "undated";

function localDate(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function dayKey(value: Date): string {
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${value.getFullYear()}-${month}-${day}`;
}

function isOpen(task: TaskResponse): boolean {
  return task.status !== "done" && task.status !== "cancelled";
}

/**
 * Tasks in the order a day-by-day view shows them: open tasks due before
 * today under Overdue, then one group per local due date in date order
 * with Today and Tomorrow named, then tasks without a due date.
 */
export function groupTasksByDay(
  tasks: readonly TaskResponse[],
  now: Date,
): TaskDayGroup[] {
  const today = localDate(now);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const overdue: TaskResponse[] = [];
  const undated: TaskResponse[] = [];
  const days = new Map<string, { date: Date; tasks: TaskResponse[] }>();
  for (const task of tasks) {
    const date = dueDay(task);
    if (date === null) {
      undated.push(task);
      continue;
    }
    if (isOpen(task) && date < today) {
      overdue.push(task);
      continue;
    }
    const key = dayKey(date);
    const day = days.get(key) ?? { date, tasks: [] };
    day.tasks.push(task);
    days.set(key, day);
  }
  const dayName = new Intl.DateTimeFormat(undefined, { weekday: "long" });
  const dayTitle = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  });
  const groups: TaskDayGroup[] = [];
  if (overdue.length > 0)
    groups.push({
      key: overdueKey,
      label: ["Overdue"],
      tone: "overdue",
      tasks: overdue.sort(byDue),
    });
  for (const [key, day] of [...days].sort(([a], [b]) => a.localeCompare(b))) {
    const relative =
      key === dayKey(today)
        ? "Today"
        : key === dayKey(tomorrow)
          ? "Tomorrow"
          : null;
    groups.push({
      key,
      label: [
        dayTitle.format(day.date),
        ...(relative === null ? [] : [relative]),
        dayName.format(day.date),
      ],
      tone: relative === "Today" ? "today" : "plain",
      tasks: day.tasks.sort(byDue),
    });
  }
  if (undated.length > 0)
    groups.push({
      key: undatedKey,
      label: ["No due date"],
      tone: "plain",
      tasks: undated,
    });
  return groups;
}

/** The local day a task is due: its date, or the local date of its instant. */
function dueDay(task: TaskResponse): Date | null {
  if (task.dueOn !== null) {
    const [year, month, day] = task.dueOn.split("-").map(Number);
    return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1);
  }
  return task.dueAt === null ? null : localDate(new Date(task.dueAt));
}

/** Date-only tasks lead their day; timed tasks follow in time order. */
function byDue(a: TaskResponse, b: TaskResponse): number {
  const left = a.dueOn === null ? (a.dueAt ?? "") : "";
  const right = b.dueOn === null ? (b.dueAt ?? "") : "";
  return left.localeCompare(right) || a.id.localeCompare(b.id);
}
