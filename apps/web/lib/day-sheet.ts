import type { EventResponse, TaskResponse } from "@chronelle/schemas";

import { activeLocale, tr } from "../i18n/active-locale";
import {
  type DayKey,
  dayKeyOf,
  eventDays,
  parseDayKey,
  taskDay,
  today,
} from "./day-placement";
import { formatDuration, formatTime } from "./format";

/** A timed schedule item on the sheet, with what the row reads. */
export interface DaySheetRow {
  readonly item: EventResponse;
  readonly start: string;
  readonly end: string;
  /** How long the item runs, when it has an end: "2 h", "30 min". */
  readonly duration: string;
  /** Whether the clock falls inside the item. */
  readonly now: boolean;
}

/** Free time before a row, when it is a quarter of an hour or more. */
export interface DaySheetGap {
  readonly minutes: number;
  /** The item the free time runs up to. */
  readonly beforeId: string;
}

/** One day of the itinerary: what the sheet lists, in order. */
export interface DaySheet {
  readonly day: DayKey;
  /** Date-only items that run over several days, read as pills at the top. */
  readonly allDay: readonly EventResponse[];
  /** Timed items in start order, each preceded by the free time before it. */
  readonly rows: readonly (DaySheetRow | DaySheetGap)[];
  /** Tasks due that day, open ones first, then by time and name. */
  readonly due: readonly TaskResponse[];
  /** Date-only items on this one day, which have no time yet. */
  readonly untimed: readonly EventResponse[];
}

/** The least free time the sheet shows as a line. */
export const shownGapMinutes = 15;

/**
 * The days the itinerary turns: the event's own dates, and every day a
 * schedule item falls on, in order; today alone when nothing has a date.
 */
export function itineraryDays(
  event: Pick<EventResponse, "startsOn" | "endsOn" | "startsAt" | "endsAt">,
  items: readonly EventResponse[],
  clock: Date = new Date(),
): DayKey[] {
  const days = new Set<DayKey>(eventDays(event as EventResponse));
  for (const item of items) for (const day of eventDays(item)) days.add(day);
  if (days.size === 0) return [dayKeyOf(today(clock))];
  return [...days].sort();
}

/** The day the sheet opens on: today when the itinerary has it, else its first day. */
export function initialItineraryDay(
  days: readonly DayKey[],
  clock: Date = new Date(),
): DayKey {
  const now = dayKeyOf(today(clock));
  return days.includes(now) ? now : (days[0] ?? now);
}

function minutesBetween(start: string, end: string): number {
  return Math.round((Date.parse(end) - Date.parse(start)) / 60_000);
}

/** The sheet of one day, composed from the itinerary and to-do projections. */
export function daySheet(
  day: DayKey,
  items: readonly EventResponse[],
  tasks: readonly TaskResponse[],
  clock: Date = new Date(),
): DaySheet {
  const onDay = items.filter((item) => eventDays(item).includes(day));
  const timed = onDay
    .filter((item) => item.startsAt !== null)
    .sort((first, second) => {
      const order = (first.startsAt ?? "").localeCompare(second.startsAt ?? "");
      return order !== 0 ? order : first.id.localeCompare(second.id);
    });
  const dated = onDay.filter((item) => item.startsAt === null);
  const rows: (DaySheetRow | DaySheetGap)[] = [];
  let previousEnd: string | null = null;
  for (const item of timed) {
    const startsAt = item.startsAt ?? "";
    if (previousEnd !== null) {
      const minutes = minutesBetween(previousEnd, startsAt);
      if (minutes >= shownGapMinutes) rows.push({ minutes, beforeId: item.id });
    }
    const ends = item.endsAt;
    rows.push({
      item,
      start: formatTime(startsAt),
      end: ends === null ? "" : formatTime(ends),
      duration:
        ends === null || minutesBetween(startsAt, ends) < 1
          ? ""
          : formatDuration(minutesBetween(startsAt, ends)),
      now:
        ends !== null &&
        Date.parse(startsAt) <= clock.getTime() &&
        clock.getTime() < Date.parse(ends),
    });
    previousEnd = ends ?? startsAt;
  }
  const rank = (task: TaskResponse) =>
    task.status === "done" || task.status === "cancelled" ? 1 : 0;
  const due = tasks
    .filter((task) => taskDay(task) === day)
    .sort(
      (first, second) =>
        rank(first) - rank(second) ||
        (first.dueAt ?? "").localeCompare(second.dueAt ?? "") ||
        first.displayName.localeCompare(second.displayName),
    );
  return {
    day,
    allDay: dated.filter((item) => item.isAllDay || eventDays(item).length > 1),
    rows,
    due,
    untimed: dated.filter(
      (item) => !item.isAllDay && eventDays(item).length === 1,
    ),
  };
}

/** Free time as the sheet reads it: "30 min free", "2 h free", "1 h 15 min free". */
export function gapText(minutes: number): string {
  const t = tr("itinerary");
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return t("gapMinutes", { minutes: rest });
  return rest === 0
    ? t("gapHours", { hours })
    : t("gapHoursMinutes", { hours, minutes: rest });
}

/** The day line's name: "Tue, Nov 3" in the active language. */
export function dayName(day: DayKey, locale: string = activeLocale()): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(parseDayKey(day));
}

/**
 * The day as plain text for a chat: the day name, the all-day items, then
 * one line per row with its times, name and place, and the untimed items
 * with a dash for a time.
 */
export function daySheetText(sheet: DaySheet): string {
  const lines = [dayName(sheet.day)];
  for (const item of sheet.allDay) lines.push(item.displayName);
  for (const row of sheet.rows) {
    if (!("item" in row)) continue;
    const when = row.end === "" ? row.start : `${row.start}-${row.end}`;
    const place = row.item.location === null ? "" : ` - ${row.item.location}`;
    lines.push(`${when}  ${row.item.displayName}${place}`);
  }
  for (const item of sheet.untimed) lines.push(`-  ${item.displayName}`);
  return lines.join("\n");
}
