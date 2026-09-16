import { type DayKey, dayKeyOf, parseDayKey } from "./day-placement";

export interface DayGroup<Item> {
  readonly key: DayKey;
  /** The heading's parts: a date, then Today or Tomorrow, then the weekday. */
  readonly label: readonly string[];
  readonly tone: "today" | "plain";
  readonly items: readonly Item[];
}

const dayName = new Intl.DateTimeFormat(undefined, { weekday: "long" });
const dayTitle = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});
// A day in another year carries its year.
const farDayTitle = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

/** The parts of a day heading: the date, Today or Tomorrow, the weekday. */
export function dayGroupLabel(
  day: DayKey,
  now: Date,
): { readonly label: readonly string[]; readonly tone: "today" | "plain" } {
  const date = parseDayKey(day);
  const today = dayKeyOf(now);
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const relative =
    day === today ? "Today" : day === dayKeyOf(tomorrow) ? "Tomorrow" : null;
  return {
    label: [
      (date.getFullYear() === now.getFullYear()
        ? dayTitle
        : farDayTitle
      ).format(date),
      ...(relative === null ? [] : [relative]),
      dayName.format(date),
    ],
    tone: relative === "Today" ? "today" : "plain",
  };
}

/**
 * Items under one heading per local day, in date order; items with no day
 * are left out. Items keep their order within a day.
 */
export function groupByDay<Item>(
  items: readonly Item[],
  dayOf: (item: Item) => DayKey | null,
  now: Date,
): DayGroup<Item>[] {
  const days = new Map<DayKey, Item[]>();
  for (const item of items) {
    const day = dayOf(item);
    if (day === null) continue;
    const group = days.get(day);
    if (group === undefined) days.set(day, [item]);
    else group.push(item);
  }
  return [...days]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, grouped]) => ({
      key,
      ...dayGroupLabel(key, now),
      items: grouped,
    }));
}
