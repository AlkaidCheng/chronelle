import type { EventResponse, TaskResponse } from "@chronelle/schemas";

import { activeWeekStart, type WeekStart } from "../i18n/active-preferences";
import { instantDayKey } from "./zone";

/**
 * A calendar day as `YYYY-MM-DD`. Days are placed in the account's zone:
 * an instant becomes a day through `instantDay`, and a day is handled as a
 * local-midnight Date from then on, so day arithmetic never touches a zone.
 */
export type DayKey = string;

/** The calendar day a local-midnight Date names, with the time dropped. */
export function localDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

/** The day of an instant in the account's zone, as a local-midnight Date. */
export function instantDate(instant: Date | string): Date {
  return parseDayKey(instantDayKey(instant));
}

/** Today in the account's zone, as a local-midnight Date. */
export function today(now: Date = new Date()): Date {
  return instantDate(now);
}

/** The key of a local-midnight Date; an instant goes through `instantDay`. */
export function dayKeyOf(value: Date): DayKey {
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${value.getFullYear()}-${month}-${day}`;
}

export function parseDayKey(key: DayKey): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1);
}

export function addDays(value: Date, days: number): Date {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}

/** The first day of the week on or before the day: Monday or Sunday as the account has it. */
export function startOfWeek(
  value: Date,
  weekStart: WeekStart = activeWeekStart(),
): Date {
  const day = localDay(value);
  const offset = (day.getDay() - (weekStart % 7) + 7) % 7;
  return addDays(day, -offset);
}

export function startOfMonth(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), 1);
}

/** The seven days of the week the cursor falls in, the account's first day first. */
export function weekDays(
  cursor: Date,
  weekStart: WeekStart = activeWeekStart(),
): DayKey[] {
  const first = startOfWeek(cursor, weekStart);
  return Array.from({ length: 7 }, (_, index) =>
    dayKeyOf(addDays(first, index)),
  );
}

/**
 * The days of the weeks the cursor's month spans, the account's first day
 * first: from the week holding the first of the month to the week holding
 * its last day.
 */
export function monthDays(
  cursor: Date,
  weekStart: WeekStart = activeWeekStart(),
): DayKey[] {
  const last = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
  return daySpan(
    startOfWeek(startOfMonth(cursor), weekStart),
    addDays(startOfWeek(last, weekStart), 6),
  );
}

/** Every local day from the first key to the last, inclusive. */
function daySpan(first: Date, last: Date): DayKey[] {
  const keys: DayKey[] = [];
  for (
    let day = localDay(first);
    day <= last && keys.length < 366;
    day = addDays(day, 1)
  )
    keys.push(dayKeyOf(day));
  return keys;
}

/** The day a task is due in the account's zone, or null when it has no due. */
export function taskDay(task: TaskResponse): DayKey | null {
  if (task.dueOn !== null) return task.dueOn;
  return task.dueAt === null ? null : instantDay(task.dueAt);
}

/** The day of an instant in the account's zone, for items that always carry one. */
export function instantDay(value: string | Date): DayKey {
  return instantDayKey(value);
}

/**
 * The days a scheduled Event covers: a date-only span inclusive of both
 * ends, a timed item from its start to its end (the same day unless the
 * end crosses midnight in the account's zone), an unscheduled item none.
 */
export function eventDays(event: EventResponse): DayKey[] {
  if (event.startsOn !== null)
    return daySpan(
      parseDayKey(event.startsOn),
      parseDayKey(event.endsOn ?? event.startsOn),
    );
  if (event.startsAt === null) return [];
  const start = new Date(event.startsAt);
  const end = event.endsAt === null ? start : new Date(event.endsAt);
  return daySpan(instantDate(start), instantDate(end < start ? start : end));
}

/** Items keyed by the local days they fall on, in the order given. */
export function placeByDay<Item>(
  items: readonly Item[],
  daysOf: (item: Item) => readonly DayKey[],
): ReadonlyMap<DayKey, Item[]> {
  const placed = new Map<DayKey, Item[]>();
  for (const item of items)
    for (const key of daysOf(item)) {
      const day = placed.get(key) ?? [];
      day.push(item);
      placed.set(key, day);
    }
  return placed;
}
