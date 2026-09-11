import type { EventResponse } from "@chronelle/schemas";
import { calendarDateSchema } from "@chronelle/schemas";
import { fromDateTimeInput, toDateTimeInput, formatDateTime } from "./format";

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

const calendarDateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeZone: "UTC",
});

export function formatCalendarDate(date: string): string {
  return calendarDateFormatter.format(new Date(`${date}T00:00:00Z`));
}

export function formatEventSchedule(
  event: Pick<EventResponse, "startsAt" | "endsAt" | "startsOn" | "endsOn">,
): string {
  if (event.startsOn)
    return (
      formatCalendarDate(event.startsOn) +
      (event.endsOn && event.endsOn !== event.startsOn
        ? ` to ${formatCalendarDate(event.endsOn)}`
        : "")
    );
  if (event.startsAt === null) return "Schedule to be decided";
  return (
    formatDateTime(event.startsAt) +
    (event.endsAt === null ? "" : ` to ${formatDateTime(event.endsAt)}`)
  );
}

export function formatEventDatePart(
  event: EventResponse,
  part: "month" | "day",
): string {
  const value = event.startsOn ?? event.startsAt;
  if (value === null) return part === "month" ? "TBD" : "-";
  return new Intl.DateTimeFormat(undefined, {
    ...(part === "month"
      ? { month: "short" as const }
      : { day: "2-digit" as const }),
    ...(event.startsOn ? { timeZone: "UTC" } : {}),
  }).format(new Date(event.startsOn ? `${value}T00:00:00Z` : value));
}
