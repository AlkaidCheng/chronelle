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

function calendarDate(value: string, locale: string): string {
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

function instant(
  value: string,
  eventTimeZone: string | null,
  preferences: EventFormatPreferences,
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
    timeZone: eventTimeZone ?? preferences.timeZone ?? undefined,
  });
  return formatted?.format(date) ?? value;
}

export function formatEventSchedule(
  event: EventResponse,
  preferences: EventFormatPreferences,
): string | null {
  if (event.startsOn !== null) {
    const start = calendarDate(event.startsOn, preferences.locale);
    if (event.endsOn === null || event.endsOn === event.startsOn) return start;
    return `${start} - ${calendarDate(event.endsOn, preferences.locale)}`;
  }
  if (event.startsAt !== null) {
    const start = instant(event.startsAt, event.timezone, preferences);
    if (event.endsAt === null || event.endsAt === event.startsAt) return start;
    return `${start} - ${instant(event.endsAt, event.timezone, preferences)}`;
  }
  return null;
}
