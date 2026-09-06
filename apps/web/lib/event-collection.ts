import type { EventResponse } from "@chronelle/schemas";

export type EventFilter = "all" | "upcoming" | "unscheduled" | "past";
export type EventSort = "date" | "name" | "updated";

type ScheduledEvent = Pick<EventResponse, "startsAt" | "endsAt">;

export function eventPeriod(
  event: ScheduledEvent,
  now: number,
): Exclude<EventFilter, "all"> {
  if (event.startsAt === null) return "unscheduled";
  return Date.parse(event.endsAt ?? event.startsAt) < now ? "past" : "upcoming";
}

/** Filters authorized records without changing their identity or source order. */
export function selectEvents(
  events: readonly EventResponse[],
  options: {
    readonly query: string;
    readonly filter: EventFilter;
    readonly sort: EventSort;
    readonly now: number;
  },
): EventResponse[] {
  const query = options.query.trim().toLocaleLowerCase();
  return events
    .filter(
      (event) =>
        event.displayName.toLocaleLowerCase().includes(query) &&
        (options.filter === "all" ||
          eventPeriod(event, options.now) === options.filter),
    )
    .sort((left, right) => {
      if (options.sort === "name")
        return (
          left.displayName.localeCompare(right.displayName) ||
          left.id.localeCompare(right.id)
        );
      if (options.sort === "updated")
        return (
          right.updatedAt.localeCompare(left.updatedAt) ||
          left.id.localeCompare(right.id)
        );
      const leftTime =
        left.startsAt === null
          ? Number.POSITIVE_INFINITY
          : Date.parse(left.startsAt);
      const rightTime =
        right.startsAt === null
          ? Number.POSITIVE_INFINITY
          : Date.parse(right.startsAt);
      return (
        (leftTime === rightTime ? 0 : leftTime < rightTime ? -1 : 1) ||
        left.displayName.localeCompare(right.displayName) ||
        left.id.localeCompare(right.id)
      );
    });
}
