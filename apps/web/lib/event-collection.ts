import type { EventResponse, EventListQuery } from "@chronelle/schemas";

type ScheduledEvent = Pick<EventResponse, "startsAt" | "endsAt">;

export function eventPeriod(
  event: ScheduledEvent,
  now: number,
): Exclude<EventListQuery["filter"], "all"> {
  if (event.startsAt === null) return "unscheduled";
  return Date.parse(event.endsAt ?? event.startsAt) < now ? "past" : "upcoming";
}
