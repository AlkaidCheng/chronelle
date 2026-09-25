import { createHash } from "node:crypto";

import type { UserPrincipal } from "@livtales/authorization";
import {
  type EventListCursor,
  type EventListQuery,
  type EventListQueryInput,
  eventListCursorSchema,
  eventListCountsSchema,
  eventListQuerySchema,
} from "@livtales/schemas";
import {
  cloudbaseListRows,
  type CloudBaseListClient,
} from "./cloudbase-list-candidates.js";
import {
  cloudbaseDate,
  cloudbaseEventResource,
  cloudbaseNullableDate,
  cloudbaseNullableText,
  cloudbaseText,
  readCloudBaseDisplayNames,
  readCloudBaseEventObjectsById,
  readCloudBaseEventsById,
  readCloudBaseGrantsOn,
} from "./cloudbase-read-support.js";
import { decodeCursor, encodeCursor } from "./cursor.js";
import { InvalidObjectStateError } from "./errors.js";
import {
  eventListAccess,
  type EventListItem,
  type EventPage,
  type EventReadRepository,
} from "./event-list.js";
import type { EventResource } from "./types.js";

type EventCandidate = Pick<
  EventResource,
  | "id"
  | "workspaceId"
  | "displayName"
  | "updatedAt"
  | "startsAt"
  | "endsAt"
  | "startsOn"
  | "endsOn"
> & { readonly own: boolean };

function cursorTimestamp(value: Date): string {
  return value.toISOString().replace("Z", "000Z");
}

function schedulePosition(event: EventCandidate): Date | null {
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
        input.scope,
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
  event: EventCandidate,
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

function compareName(first: EventCandidate, second: EventCandidate): number {
  return (
    first.displayName
      .toLocaleLowerCase()
      .localeCompare(second.displayName.toLocaleLowerCase()) ||
    first.id.localeCompare(second.id)
  );
}

function compareDate(first: EventCandidate, second: EventCandidate): number {
  const firstDate = schedulePosition(first);
  const secondDate = schedulePosition(second);
  if (firstDate === null && secondDate !== null) return 1;
  if (firstDate !== null && secondDate === null) return -1;
  return (
    (firstDate?.getTime() ?? 0) - (secondDate?.getTime() ?? 0) ||
    compareName(first, second)
  );
}

function compareUpdated(first: EventCandidate, second: EventCandidate): number {
  return (
    second.updatedAt.getTime() - first.updatedAt.getTime() ||
    first.id.localeCompare(second.id)
  );
}

function afterCursor(
  event: EventCandidate,
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
  event: EventCandidate,
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
  readonly #client: CloudBaseListClient;
  readonly #clock: () => Date;

  constructor(
    client: CloudBaseListClient,
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
    const now = this.#clock();
    // Locale-sensitive matching stays in JavaScript. For an empty query the
    // database can count all chips and bound the updated-order keyset itself.
    const queryCounts = cursor === undefined && input.query !== "";
    const bounded = input.query === "" && input.sort === "updated";
    const result = await this.#client.rpc<{ rows: unknown; counts: unknown }>(
      "chronelle_event_list_candidates",
      {
        workspace_id: principal.workspaceId,
        user_id: principal.userId,
        access_at: now.toISOString(),
        as_of: asOf.toISOString(),
        list_scope: queryCounts ? "all" : input.scope,
        period: queryCounts ? "all" : input.filter,
        page_limit: bounded ? input.limit + 1 : null,
        after_position: bounded ? (cursor ?? null) : null,
        include_counts: cursor === undefined && !queryCounts,
      },
    );
    const candidates = cloudbaseListRows(result.rows).map(
      (row): EventCandidate => ({
        id: cloudbaseText(row.id, "object id"),
        workspaceId: cloudbaseText(row.workspace_id, "workspace id"),
        displayName: cloudbaseText(row.display_name, "display name"),
        updatedAt: cloudbaseDate(row.updated_at, "updated_at"),
        startsAt: cloudbaseNullableDate(row.starts_at, "starts_at"),
        endsAt: cloudbaseNullableDate(row.ends_at, "ends_at"),
        startsOn: cloudbaseNullableText(row.starts_on, "starts_on"),
        endsOn: cloudbaseNullableText(row.ends_on, "ends_on"),
        own: row.own === true,
      }),
    );
    const matching = (event: EventCandidate) =>
      input.query === "" ||
      event.displayName
        .toLocaleLowerCase()
        .includes(input.query.toLocaleLowerCase());
    let events = candidates.filter(
      (event) =>
        matching(event) &&
        matchesPeriod(event, input.filter, asOf) &&
        (input.scope === "all" ||
          (input.scope === "mine" ? event.own : !event.own)),
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
    const ids = page.map((event) => event.id);
    const [objects, eventRows] = await Promise.all([
      readCloudBaseEventObjectsById(this.#client, ids),
      readCloudBaseEventsById(this.#client, ids),
    ]);
    const objectsById = new Map(
      objects
        .filter((object) => object.permission_scope_id === object.id)
        .map((object) => [cloudbaseText(object.id, "object id"), object]),
    );
    const eventsById = new Map(
      eventRows.map((event) => [
        cloudbaseText(event.object_id, "event id"),
        event,
      ]),
    );
    const resources = page.flatMap(({ id }) => {
      const object = objectsById.get(id);
      const event = eventsById.get(id);
      return object === undefined || event === undefined
        ? []
        : [cloudbaseEventResource(object, event)];
    });
    const items = await this.#withAccess(
      principal.userId,
      new Set(
        page.filter((event) => event.own).map((event) => event.workspaceId),
      ),
      resources,
      now,
    );
    // The chips count the whole list once, under the query alone.
    let counts =
      result.counts === null
        ? null
        : eventListCountsSchema.parse(result.counts);
    if (queryCounts) {
      const everything = candidates.filter(matching);
      const mine = everything.filter((event) => event.own).length;
      counts = {
        all: everything.length,
        mine,
        shared: everything.length - mine,
        upcoming: everything.filter((event) =>
          matchesPeriod(event, "upcoming", asOf),
        ).length,
        past: everything.filter((event) => matchesPeriod(event, "past", asOf))
          .length,
      };
    }
    const asOfValue = cursor?.asOf ?? cursorTimestamp(asOf);
    return {
      items,
      asOf: asOfValue,
      counts,
      nextCursor:
        events.length > input.limit && page.at(-1) !== undefined
          ? pageCursor(page.at(-1) as EventCandidate, context, asOfValue)
          : null,
    };
  }

  async #withAccess(
    userId: string,
    memberWorkspaceIds: ReadonlySet<string>,
    page: readonly EventResource[],
    now: Date,
  ): Promise<EventListItem[]> {
    if (page.length === 0) return [];
    const grants = await readCloudBaseGrantsOn(
      this.#client,
      page.map((event) => event.id),
      now,
    );
    const displayNames = await readCloudBaseDisplayNames(this.#client, [
      ...new Set(grants.map((grant) => grant.grantedBy)),
    ]);
    return page.map((event) => ({
      ...event,
      access: eventListAccess(
        event,
        userId,
        memberWorkspaceIds,
        grants,
        displayNames,
      ),
    }));
  }
}
