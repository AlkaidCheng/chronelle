import { type DayKey, addDays, dayKeyOf, parseDayKey } from "./day-placement";

/** A quick way to a due day, with the day it means. */
export interface DueShortcut {
  readonly id:
    "today" | "tomorrow" | "later-this-week" | "weekend" | "next-week";
  readonly label: string;
  readonly day: DayKey;
}

const weekday = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const monthDay = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});
const monthDayYear = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

/**
 * The shortcuts that make sense from a given day: Today unless the choice
 * is today, Tomorrow, Later this week (two days on while that is still
 * Friday or earlier), This weekend (the coming Saturday, not on a
 * weekend), and Next week (the coming Monday).
 */
export function dueShortcuts(now: Date, chosen: DayKey | null): DueShortcut[] {
  const today = dayKeyOf(now);
  const day = now.getDay(); // 0 Sunday .. 6 Saturday
  const shortcuts: DueShortcut[] = [];
  if (chosen !== today)
    shortcuts.push({ id: "today", label: "Today", day: today });
  shortcuts.push({
    id: "tomorrow",
    label: "Tomorrow",
    day: dayKeyOf(addDays(now, 1)),
  });
  if (day >= 1 && day <= 3)
    shortcuts.push({
      id: "later-this-week",
      label: "Later this week",
      day: dayKeyOf(addDays(now, 2)),
    });
  if (day >= 1 && day <= 5)
    shortcuts.push({
      id: "weekend",
      label: "This weekend",
      day: dayKeyOf(addDays(now, 6 - day)),
    });
  shortcuts.push({
    id: "next-week",
    label: "Next week",
    day: dayKeyOf(addDays(now, day === 0 ? 1 : 8 - day)),
  });
  return shortcuts;
}

/** A due day in words: Today, Tomorrow, or the date, with the weekday. */
export function describeDueDay(day: DayKey, now: Date): string {
  const date = parseDayKey(day);
  if (day === dayKeyOf(now)) return "Today";
  if (day === dayKeyOf(addDays(now, 1))) return "Tomorrow";
  return date.getFullYear() === now.getFullYear()
    ? monthDay.format(date)
    : monthDayYear.format(date);
}

/** The weekday a due day falls on, short. */
export function dueWeekday(day: DayKey): string {
  return weekday.format(parseDayKey(day));
}

const monthNames = Array.from({ length: 12 }, (_, month) =>
  new Intl.DateTimeFormat("en-US", { month: "long" })
    .format(new Date(2000, month, 1))
    .toLowerCase(),
);

function monthIndex(text: string): number {
  const lower = text.toLowerCase();
  return monthNames.findIndex(
    (name) => name === lower || (lower.length >= 3 && name.startsWith(lower)),
  );
}

function validDay(year: number, month: number, day: number): DayKey | null {
  if (year < 1 || year > 9999 || month < 0 || month > 11 || day < 1)
    return null;
  const date = new Date(year, month, day);
  if (date.getMonth() !== month || date.getDate() !== day) return null;
  return dayKeyOf(date);
}

/**
 * The day some typed text names: an ISO date, "today", "tomorrow", "next
 * week", a month name with a day such as "Sep 21" or "21 Sep" with an
 * optional year (this year without one, the next when that day has
 * passed), or a numeric "9/21"; null for anything else.
 */
export function parseDueText(text: string, now: Date): DayKey | null {
  const value = text
    .trim()
    .toLowerCase()
    .replace(/,/g, " ")
    .replace(/\s+/g, " ");
  if (value === "") return null;
  if (value === "today") return dayKeyOf(now);
  if (value === "tomorrow") return dayKeyOf(addDays(now, 1));
  if (value === "next week")
    return dayKeyOf(addDays(now, now.getDay() === 0 ? 1 : 8 - now.getDay()));
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  if (iso) return validDay(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const numeric = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(value);
  if (numeric)
    return upcoming(
      Number(numeric[1]) - 1,
      Number(numeric[2]),
      numeric[3] === undefined ? null : Number(numeric[3]),
      now,
    );
  const monthFirst = /^([a-z]+) (\d{1,2})(?: (\d{4}))?$/.exec(value);
  if (monthFirst)
    return upcoming(
      monthIndex(monthFirst[1] ?? ""),
      Number(monthFirst[2]),
      monthFirst[3] === undefined ? null : Number(monthFirst[3]),
      now,
    );
  const dayFirst = /^(\d{1,2}) ([a-z]+)(?: (\d{4}))?$/.exec(value);
  if (dayFirst)
    return upcoming(
      monthIndex(dayFirst[2] ?? ""),
      Number(dayFirst[1]),
      dayFirst[3] === undefined ? null : Number(dayFirst[3]),
      now,
    );
  return null;
}

/**
 * A month and day in the given year, else the next year from this one in
 * which the day exists and has not passed (February 29 waits for a leap year).
 */
function upcoming(
  month: number,
  day: number,
  year: number | null,
  now: Date,
): DayKey | null {
  if (month < 0) return null;
  if (year !== null)
    return validDay(year < 100 ? 2000 + year : year, month, day);
  const today = dayKeyOf(now);
  for (let offset = 0; offset < 8; offset += 1) {
    const candidate = validDay(now.getFullYear() + offset, month, day);
    if (candidate !== null && candidate >= today) return candidate;
  }
  return null;
}
