import { type DayKey, addDays, dayKeyOf, parseDayKey } from "./day-placement";

/** A quick way to a due day, with the day it means. */
export interface DueShortcut {
  readonly id:
    "today" | "tomorrow" | "later-this-week" | "weekend" | "next-week";
  readonly label: string;
  readonly day: DayKey;
}

const weekday = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const monthDayYear = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

/**
 * The shortcuts a day allows: Today, Tomorrow, Later this week (two days
 * on while that is still Friday or earlier), This weekend (the coming
 * Saturday, not on a weekend), and Next week (the coming Monday). Every
 * one stays offered; the control marks the one matching the choice.
 */
export function dueShortcuts(now: Date): DueShortcut[] {
  const today = dayKeyOf(now);
  const day = now.getDay(); // 0 Sunday .. 6 Saturday
  const shortcuts: DueShortcut[] = [];
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

/** The exact date of a due day, always with its year. */
export function exactDueDay(day: DayKey): string {
  return monthDayYear.format(parseDayKey(day));
}

/** A due day in words: the exact date, with today or tomorrow as a hint. */
export function describeDueDay(day: DayKey, now: Date): string {
  const exact = exactDueDay(day);
  if (day === dayKeyOf(now)) return `${exact} (today)`;
  if (day === dayKeyOf(addDays(now, 1))) return `${exact} (tomorrow)`;
  return exact;
}

const monthNames = Array.from({ length: 12 }, (_, month) =>
  new Intl.DateTimeFormat("en-US", { month: "long" })
    .format(new Date(2000, month, 1))
    .toLowerCase(),
);

/** A month name, or its first three letters, as a month index; -1 otherwise. */
function monthIndex(text: string): number {
  const lower = text.toLowerCase();
  return monthNames.findIndex(
    (name) => name === lower || (lower.length >= 3 && name.startsWith(lower)),
  );
}

/**
 * The month some typed text names, as YYYY-MM: "October 2027", "Oct 2027",
 * "2027-10", "10/2027", or a month name alone for the current year; null
 * for anything else.
 */
export function parseMonthText(text: string, now: Date): string | null {
  const value = text
    .trim()
    .toLowerCase()
    .replace(/,/g, " ")
    .replace(/\s+/g, " ");
  const pad = (month: number) => String(month).padStart(2, "0");
  const iso = /^(\d{4})-(\d{1,2})$/.exec(value);
  if (iso) {
    const month = Number(iso[2]);
    return month >= 1 && month <= 12 ? `${iso[1]}-${pad(month)}` : null;
  }
  const numeric = /^(\d{1,2})\/(\d{4})$/.exec(value);
  if (numeric) {
    const month = Number(numeric[1]);
    return month >= 1 && month <= 12 ? `${numeric[2]}-${pad(month)}` : null;
  }
  const named = /^([a-z]+)(?: (\d{4}))?$/.exec(value);
  if (named) {
    const month = monthIndex(named[1] ?? "");
    return month < 0
      ? null
      : `${named[2] ?? String(now.getFullYear())}-${pad(month + 1)}`;
  }
  const yearFirst = /^(\d{4}) ([a-z]+)$/.exec(value);
  if (yearFirst) {
    const month = monthIndex(yearFirst[2] ?? "");
    return month < 0 ? null : `${yearFirst[1]}-${pad(month + 1)}`;
  }
  return null;
}

/** The weekday a due day falls on, short. */
export function dueWeekday(day: DayKey): string {
  return weekday.format(parseDayKey(day));
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
