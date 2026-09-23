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

export function formatEventSchedule(
  event: Pick<
    EventResponse,
    "startsOn" | "endsOn" | "startsAt" | "endsAt" | "timezone"
  >,
  preferences: EventFormatPreferences,
): string | null {
  if (event.startsOn !== null) {
    const start = formatCalendarDate(event.startsOn, preferences.locale);
    if (event.endsOn === null || event.endsOn === event.startsOn) return start;
    return `${start} - ${formatCalendarDate(event.endsOn, preferences.locale)}`;
  }
  if (event.startsAt !== null) {
    const start = formatInstant(event.startsAt, preferences, event.timezone);
    if (event.endsAt === null || event.endsAt === event.startsAt) return start;
    return `${start} - ${formatInstant(event.endsAt, preferences, event.timezone)}`;
  }
  return null;
}
