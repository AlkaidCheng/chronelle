import { activeLocale, tr } from "../i18n/active-locale";
import {
  type DayKey,
  addDays,
  dayKeyOf,
  instantDate,
  parseDayKey,
} from "./day-placement";

export interface DayGroup<Item> {
  readonly key: DayKey;
  /** The heading's parts: a date, then Today or Tomorrow, then the weekday. */
  readonly label: readonly string[];
  readonly tone: "today" | "plain";
  readonly items: readonly Item[];
}

/** The parts of a day heading: the date, Today or Tomorrow, the weekday. */
export function dayGroupLabel(
  day: DayKey,
  clock: Date,
): { readonly label: readonly string[]; readonly tone: "today" | "plain" } {
  const locale = activeLocale();
  const date = parseDayKey(day);
  const now = instantDate(clock);
  const today = dayKeyOf(now);
  const relative =
    day === today
      ? "today"
      : day === dayKeyOf(addDays(now, 1))
        ? "tomorrow"
        : null;
  // A day in another year carries its year.
  const title = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
  return {
    label: [
      title.format(date),
      ...(relative === null ? [] : [tr("dates")(relative)]),
      new Intl.DateTimeFormat(locale, { weekday: "long" }).format(date),
    ],
    tone: relative === "today" ? "today" : "plain",
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
