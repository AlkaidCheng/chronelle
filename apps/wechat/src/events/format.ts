import type { EventResponse, HourCycle } from "@chronelle/schemas";

export interface EventFormatPreferences {
  readonly hourCycle: HourCycle | null;
  readonly locale: string;
  readonly timeZone: string | null;
}

function formatter(
  locale: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat | null {
  try {
    return new Intl.DateTimeFormat(locale, options);
  } catch {
    return null;
  }
}

export function formatCalendarDate(value: string, locale: string): string {
  const [year, month, day] = value.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined)
    return value;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    formatter(locale, {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
      year: "numeric",
    })?.format(date) ?? value
  );
}

export function formatInstant(
  value: string,
  preferences: EventFormatPreferences,
  timeZone: string | null = preferences.timeZone,
): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const formatted = formatter(preferences.locale, {
    dateStyle: "medium",
    hour12:
      preferences.hourCycle === null
        ? undefined
        : preferences.hourCycle === "h12",
    timeStyle: "short",
    timeZone: timeZone ?? undefined,
  });
  return formatted?.format(date) ?? value;
}

const rangeSeparator = " \u2013 ";
const timeSpanSeparator = "\u2013";

function calendarDate(value: string): Date | null {
  const [year, month, day] = value.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined)
    return null;
  return new Date(Date.UTC(year, month - 1, day));
}

/** The calendar day an instant falls on in a zone, as YYYY-MM-DD. */
function dayKey(date: Date, timeZone: string | undefined): string {
  const parts = formatter("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  })?.formatToParts(date);
  const part = (type: string) =>
    parts?.find((candidate) => candidate.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** Whether a schedule must name its year: outside the current one, or spanning two. */
function namesYear(
  dates: readonly Date[],
  timeZone: string | undefined,
  now: Date,
  nowZone: string | undefined,
): boolean {
  const current = dayKey(now, nowZone).slice(0, 4);
  const years = new Set(
    dates.map((date) => dayKey(date, timeZone).slice(0, 4)),
  );
  return years.size > 1 || !years.has(current);
}

function dayOptions(
  withYear: boolean,
  timeZone: string | undefined,
): Intl.DateTimeFormatOptions {
  return {
    day: "numeric",
    month: "short",
    timeZone,
    weekday: "short",
    ...(withYear ? { year: "numeric" } : {}),
  };
}

function timeOptions(
  preferences: EventFormatPreferences,
  timeZone: string | undefined,
): Intl.DateTimeFormatOptions {
  return {
    hour: "numeric",
    hour12:
      preferences.hourCycle === null
        ? undefined
        : preferences.hourCycle === "h12",
    minute: "2-digit",
    timeZone,
  };
}

/**
 * An Event's schedule, compact: weekday and date, the year only when it is not
 * the current year, and one date for a timed Event that starts and ends the
 * same day. Calendar dates keep their day in every zone; instants read in the
 * Event's zone, else the account's.
 */
export function formatEventSchedule(
  event: Pick<
    EventResponse,
    "startsOn" | "endsOn" | "startsAt" | "endsAt" | "timezone"
  >,
  preferences: EventFormatPreferences,
  now: Date = new Date(),
): string | null {
  const nowZone = preferences.timeZone ?? undefined;
  if (event.startsOn !== null) {
    const start = calendarDate(event.startsOn);
    if (start === null) return event.startsOn;
    const end =
      event.endsOn === null || event.endsOn === event.startsOn
        ? null
        : calendarDate(event.endsOn);
    const dates = end === null ? [start] : [start, end];
    const day = formatter(
      preferences.locale,
      dayOptions(namesYear(dates, "UTC", now, nowZone), "UTC"),
    );
    if (day === null) return event.startsOn;
    return end === null
      ? day.format(start)
      : `${day.format(start)}${rangeSeparator}${day.format(end)}`;
  }
  if (event.startsAt !== null) {
    const zone = event.timezone ?? nowZone;
    const start = new Date(event.startsAt);
    if (Number.isNaN(start.getTime())) return event.startsAt;
    const end =
      event.endsAt === null || event.endsAt === event.startsAt
        ? null
        : new Date(event.endsAt);
    const dates = end === null ? [start] : [start, end];
    const moment = formatter(preferences.locale, {
      ...dayOptions(namesYear(dates, zone, now, nowZone), zone),
      ...timeOptions(preferences, zone),
    });
    if (moment === null) return event.startsAt;
    if (end === null || Number.isNaN(end.getTime()))
      return moment.format(start);
    if (dayKey(start, zone) === dayKey(end, zone)) {
      const time = formatter(
        preferences.locale,
        timeOptions(preferences, zone),
      );
      return `${moment.format(start)}${timeSpanSeparator}${time?.format(end) ?? ""}`;
    }
    return `${moment.format(start)}${rangeSeparator}${moment.format(end)}`;
  }
  return null;
}
