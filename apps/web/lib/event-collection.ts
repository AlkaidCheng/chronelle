import type { EventResponse, EventListQuery } from "@chronelle/schemas";

type ScheduledEvent = Pick<EventResponse, "startsAt" | "endsAt"> &
  Partial<Pick<EventResponse, "startsOn" | "endsOn" | "timezone">>;

export function eventPeriod(
  event: ScheduledEvent,
  now: number,
): Exclude<EventListQuery["filter"], "all"> {
  if (event.startsOn) {
    const parts = new Intl.DateTimeFormat("en", {
      timeZone: event.timezone ?? "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(now));
    const part = (type: string) =>
      parts.find((part) => part.type === type)?.value ?? "";
    const today = `${part("year").padStart(4, "0")}-${part("month")}-${part("day")}`;
    return (event.endsOn ?? event.startsOn) < today ? "past" : "upcoming";
  }
  if (event.startsAt === null) return "unscheduled";
  return Date.parse(event.endsAt ?? event.startsAt) < now ? "past" : "upcoming";
}
