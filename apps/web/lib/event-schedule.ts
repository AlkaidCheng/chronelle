import type { EventResponse } from "@chronelle/schemas";
import { calendarDateSchema } from "@chronelle/schemas";
import { activeLocale, tr } from "../i18n/active-locale";
import { instantOptions } from "../i18n/active-preferences";
import { formatDateTime, fromDateTimeInput, toDateTimeInput } from "./format";

export interface EventScheduleDraft {
  mode: "unscheduled" | "dates" | "timed";
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
}

export function readEventSchedule(event?: EventResponse): EventScheduleDraft {
  const start = toDateTimeInput(event?.startsAt ?? null);
  const end = toDateTimeInput(event?.endsAt ?? null);
  return {
    mode: event?.startsOn ? "dates" : start ? "timed" : "unscheduled",
    startDate: event?.startsOn ?? start.slice(0, 10),
    endDate: event?.endsOn ?? end.slice(0, 10),
    startTime: start.slice(11),
    endTime: end.slice(11),
  };
}

function localInstant(date: string, time: string): string {
  if (
    !calendarDateSchema.safeParse(date).success ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)
  )
    throw new Error("Enter a valid date and time (HH:mm).");
  const input = `${date}T${time}`;
  const instant = fromDateTimeInput(input);
  if (instant === null || toDateTimeInput(instant) !== input)
    throw new Error(
      "This local time does not exist because the clock changes. Choose another time.",
    );
  return instant;
}

export function eventSchedulePayload(draft: EventScheduleDraft) {
  const empty = { startsOn: null, endsOn: null, startsAt: null, endsAt: null };
  if (draft.mode === "unscheduled") return empty;
  if (!draft.startDate) throw new Error("Choose a start date.");
  if (
    !calendarDateSchema.safeParse(draft.startDate).success ||
    (draft.endDate && !calendarDateSchema.safeParse(draft.endDate).success)
  )
    throw new Error("Enter valid calendar dates.");
  if (draft.endDate && draft.endDate < draft.startDate)
    throw new Error("End date must not precede start date.");
  if (draft.mode === "dates")
    return {
      ...empty,
      startsOn: draft.startDate,
      endsOn: draft.endDate || null,
    };
  const endDate =
    draft.endDate === draft.startDate && !draft.endTime ? "" : draft.endDate;
  if (Boolean(endDate) !== Boolean(draft.endTime))
    throw new Error("Provide both an end date and time, or leave both empty.");
  const startsAt = localInstant(draft.startDate, draft.startTime);
  const endsAt = endDate ? localInstant(endDate, draft.endTime) : null;
  if (endsAt !== null && endsAt < startsAt)
    throw new Error("End time must not precede start time.");
  return { ...empty, startsAt, endsAt };
}

/** A calendar date in the active locale, the day it names in every zone. */
export function formatCalendarDate(
  date: string,
  locale: string = activeLocale(),
): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

export function formatEventSchedule(
  event: Pick<EventResponse, "startsAt" | "endsAt" | "startsOn" | "endsOn">,
): string {
  const range = (start: string, end: string) =>
    tr("dates")("range", { start, end });
  if (event.startsOn) {
    const start = formatCalendarDate(event.startsOn);
    return event.endsOn && event.endsOn !== event.startsOn
      ? range(start, formatCalendarDate(event.endsOn))
      : start;
  }
  if (event.startsAt === null) return "";
  const start = formatDateTime(event.startsAt);
  return event.endsAt === null
    ? start
    : range(start, formatDateTime(event.endsAt));
}

export function formatEventDatePart(
  event: EventResponse,
  part: "month" | "day",
): string {
  const value = event.startsOn ?? event.startsAt;
  if (value === null) return tr("dates")(part === "month" ? "tbd" : "noDay");
  return new Intl.DateTimeFormat(activeLocale(), {
    ...(part === "month"
      ? { month: "short" as const }
      : { day: "2-digit" as const }),
    ...(event.startsOn ? { timeZone: "UTC" } : instantOptions()),
  }).format(new Date(event.startsOn ? `${value}T00:00:00Z` : value));
}
