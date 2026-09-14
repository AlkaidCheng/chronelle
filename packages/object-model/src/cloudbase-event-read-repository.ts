import { createHash } from "node:crypto";

import type { UserPrincipal } from "@chronelle/authorization";
import type { CloudBaseRdbReader } from "@chronelle/db";
import {
  type EventListCursor,
  type EventListQuery,
  type EventListQueryInput,
  eventListCursorSchema,
  eventListQuerySchema,
} from "@chronelle/schemas";
import {
  cloudbaseEventResource,
  cloudbaseText,
  isCloudBaseRootObject,
  readCloudBaseEvents,
  readCloudBaseVisibility,
  readCloudBaseVisibleObjects,
} from "./cloudbase-read-support.js";
import { decodeCursor, encodeCursor } from "./cursor.js";
import { InvalidObjectStateError } from "./errors.js";
import type { EventPage, EventReadRepository } from "./event-list.js";
import type { EventResource } from "./types.js";

function cursorTimestamp(value: Date): string {
  return value.toISOString().replace("Z", "000Z");
}

function schedulePosition(event: EventResource): Date | null {
  if (event.startsAt !== null) return event.startsAt;
  return event.startsOn === null
    ? null
    : new Date(`${event.startsOn}T00:00:00.000Z`);
}

function contextHash(principal: UserPrincipal, input: EventListQuery): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        principal.userId,
        principal.workspaceId,
        input.query,
        input.filter,
        input.sort,
      ]),
    )
    .digest("hex");
}

function readCursor(
  token: string | undefined,
  context: string,
): EventListCursor | undefined {
  if (token === undefined) return undefined;
  try {
    const cursor = eventListCursorSchema.parse(decodeCursor(token));
    if (cursor.context === context) return cursor;
  } catch {
    // Invalid encoding, shape, and context have the same public failure.
  }
  throw new InvalidObjectStateError(
    "The event cursor is invalid for this query.",
  );
}

function matchesPeriod(
  event: EventResource,
  filter: EventListQuery["filter"],
  asOf: Date,
): boolean {
  const scheduled = schedulePosition(event);
  if (filter === "all") return true;
  if (filter === "unscheduled") return scheduled === null;
  if (scheduled === null) return false;
  const day = asOf.toISOString().slice(0, 10);
  const endDay = event.endsOn ?? event.startsOn;
  const endAt = event.endsAt ?? event.startsAt;
  return filter === "past"
    ? (endDay !== null && endDay < day) ||
        (endAt !== null && endAt.getTime() < asOf.getTime())
    : (endDay !== null && endDay >= day) ||
        (endAt !== null && endAt.getTime() >= asOf.getTime());
}

function compareName(first: EventResource, second: EventResource): number {
  return (
    first.displayName
      .toLocaleLowerCase()
      .localeCompare(second.displayName.toLocaleLowerCase()) ||
    first.id.localeCompare(second.id)
  );
}

function compareDate(first: EventResource, second: EventResource): number {
  const firstDate = schedulePosition(first);
  const secondDate = schedulePosition(second);
  if (firstDate === null && secondDate !== null) return 1;
  if (firstDate !== null && secondDate === null) return -1;
  return (
    (firstDate?.getTime() ?? 0) - (secondDate?.getTime() ?? 0) ||
    compareName(first, second)
  );
}

function compareUpdated(first: EventResource, second: EventResource): number {
  return (
    second.updatedAt.getTime() - first.updatedAt.getTime() ||
    first.id.localeCompare(second.id)
  );
}

function afterCursor(
  event: EventResource,
  cursor: EventListCursor,
  sort: EventListQuery["sort"],
): boolean {
  if (sort === "name") {
    const name = event.displayName.toLocaleLowerCase();
    return name > cursor.name || (name === cursor.name && event.id > cursor.id);
  }
  if (sort === "updated") {
    const updated = event.updatedAt.getTime();
    const cursorUpdated = new Date(cursor.updatedAt).getTime();
    return (
      updated < cursorUpdated ||
      (updated === cursorUpdated && event.id > cursor.id)
    );
  }
  const position =
    schedulePosition(event)?.getTime() ?? Number.POSITIVE_INFINITY;
  const cursorPosition =
    cursor.startsAt === null
      ? Number.POSITIVE_INFINITY
      : new Date(cursor.startsAt).getTime();
  if (position !== cursorPosition) return position > cursorPosition;
  const name = event.displayName.toLocaleLowerCase();
  return name > cursor.name || (name === cursor.name && event.id > cursor.id);
}

function pageCursor(
  event: EventResource,
  context: string,
  asOf: string,
): string {
  return encodeCursor({
    formatVersion: 1,
    context,
    asOf,
    id: event.id,
    name: event.displayName.toLocaleLowerCase(),
    startsAt:
      schedulePosition(event) === null
        ? null
        : cursorTimestamp(schedulePosition(event) as Date),
    updatedAt: cursorTimestamp(event.updatedAt),
  } satisfies EventListCursor);
}

/** Read-only CloudBase event list with the PostgreSQL cursor envelope. */
export class CloudBaseEventReadRepository implements EventReadRepository {
  readonly #client: CloudBaseRdbReader;
  readonly #clock: () => Date;

  constructor(
    client: CloudBaseRdbReader,
    clock: () => Date = () => new Date(),
  ) {
    this.#client = client;
    this.#clock = clock;
  }

  async listEvents(
    principal: UserPrincipal,
    options: EventListQueryInput = {},
  ): Promise<EventPage> {
    const input = eventListQuerySchema.parse(options);
    const context = contextHash(principal, input);
    const cursor = readCursor(input.cursor, context);
    const asOf = cursor === undefined ? this.#clock() : new Date(cursor.asOf);
    const visibility = await readCloudBaseVisibility(
      this.#client,
      principal,
      this.#clock,
    );
    // The list shows root Events only, matching the PostgreSQL query.
    const objects = (
      await readCloudBaseVisibleObjects(this.#client, principal, visibility)
    ).filter(isCloudBaseRootObject);
    const objectIds = objects.map((object) =>
      cloudbaseText(object.id, "object id"),
    );
    const eventRows = await readCloudBaseEvents(
      this.#client,
      principal,
      objectIds,
    );
    const byId = new Map(
      eventRows.map((event) => [
        cloudbaseText(event.object_id, "event object"),
        event,
      ]),
    );
    let events = objects.flatMap((object) => {
      const event = byId.get(cloudbaseText(object.id, "object id"));
      return event === undefined ? [] : [cloudbaseEventResource(object, event)];
    });
    events = events.filter(
      (event) =>
        (input.query === "" ||
          event.displayName
            .toLocaleLowerCase()
            .includes(input.query.toLocaleLowerCase())) &&
        matchesPeriod(event, input.filter, asOf),
    );
    events.sort(
      input.sort === "name"
        ? compareName
        : input.sort === "updated"
          ? compareUpdated
          : compareDate,
    );
    if (cursor !== undefined)
      events = events.filter((event) => afterCursor(event, cursor, input.sort));
    const page = events.slice(0, input.limit);
    const asOfValue = cursor?.asOf ?? cursorTimestamp(asOf);
    return {
      items: page,
      asOf: asOfValue,
      nextCursor:
        events.length > input.limit && page.at(-1) !== undefined
          ? pageCursor(page.at(-1) as EventResource, context, asOfValue)
          : null,
    };
  }
}
