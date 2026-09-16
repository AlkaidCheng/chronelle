import type { EventResponse, TaskResponse } from "@chronelle/schemas";

/** A local calendar day as `YYYY-MM-DD`. */
export type DayKey = string;

export function localDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

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

/** The Monday on or before the day. */
export function startOfWeek(value: Date): Date {
  const day = localDay(value);
  const offset = (day.getDay() + 6) % 7;
  return addDays(day, -offset);
}

export function startOfMonth(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), 1);
}

/** The seven local days of the week the cursor falls in, Monday first. */
export function weekDays(cursor: Date): DayKey[] {
  const monday = startOfWeek(cursor);
  return Array.from({ length: 7 }, (_, index) =>
    dayKeyOf(addDays(monday, index)),
  );
}

/**
 * The local days of the weeks the cursor's month spans, Monday first: from
 * the week holding the first of the month to the week holding its last day.
 */
export function monthDays(cursor: Date): DayKey[] {
  const last = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
  return daySpan(
    startOfWeek(startOfMonth(cursor)),
    addDays(startOfWeek(last), 6),
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

/** The local day a task is due, or null when it has no due. */
export function taskDay(task: TaskResponse): DayKey | null {
  if (task.dueOn !== null) return task.dueOn;
  return task.dueAt === null ? null : dayKeyOf(new Date(task.dueAt));
}

/** The local day of an instant, for items that always carry one. */
export function instantDay(value: string): DayKey {
  return dayKeyOf(new Date(value));
}

/**
 * The local days a scheduled Event covers: a date-only span inclusive of
 * both ends, a timed item from its start to its end (the same day unless
 * the end crosses midnight), an unscheduled item none.
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
  return daySpan(start, localDay(end < start ? start : end));
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
