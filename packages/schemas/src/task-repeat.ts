import { z } from "zod";

/** How a task repeats from its due. */
export const taskRepeatRuleSchema = z.enum([
  "daily",
  "weekdays",
  "weekly",
  "biweekly",
  "monthly",
  "yearly",
]);
export type TaskRepeatRule = z.infer<typeof taskRepeatRuleSchema>;

/**
 * The next occurrence after a due date under a repeat rule: a day, the next
 * weekday, a week, two weeks, a month, or a year on, the last two clamped to
 * the target month's last day. Dates are calendar dates (YYYY-MM-DD).
 */
export function nextTaskDueDate(due: string, rule: TaskRepeatRule): string {
  const [year, month, day] = due.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  switch (rule) {
    case "daily":
      return dateKey(Date.UTC(year, month - 1, day + 1));
    case "weekdays": {
      let next = Date.UTC(year, month - 1, day + 1);
      while ([0, 6].includes(new Date(next).getUTCDay())) next += 86_400_000;
      return dateKey(next);
    }
    case "weekly":
      return dateKey(Date.UTC(year, month - 1, day + 7));
    case "biweekly":
      return dateKey(Date.UTC(year, month - 1, day + 14));
    case "monthly":
      return dateKey(clampedMonth(year, month, day));
    case "yearly":
      return dateKey(clampedMonth(year + 1, month - 1, day));
  }
}

/** An instant advances by its UTC date, keeping its UTC time of day. */
export function nextTaskDueAt(due: Date, rule: TaskRepeatRule): Date {
  const next = nextTaskDueDate(due.toISOString().slice(0, 10), rule);
  return new Date(`${next}T${due.toISOString().slice(11)}`);
}

/** The calendar date a due falls on: the date itself, or the instant's UTC date. */
export function taskDueDate(
  dueOn: string | null,
  dueAt: Date | null,
): string | null {
  if (dueOn !== null) return dueOn;
  if (dueAt !== null) return dueAt.toISOString().slice(0, 10);
  return null;
}

/** A day of a month (zero-based, rolling over the year), clamped to the month's last day. */
function clampedMonth(year: number, monthIndex: number, day: number): number {
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return Date.UTC(year, monthIndex, Math.min(day, lastDay));
}

function dateKey(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}
