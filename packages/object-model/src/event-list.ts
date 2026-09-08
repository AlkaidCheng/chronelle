import { createHash } from "node:crypto";
import {
  withReadAuthorization,
  type AuthorizationDatabase,
  type UserPrincipal,
} from "@chronelle/authorization";
import { events, objects } from "@chronelle/db";
import {
  eventListCursorSchema,
  eventListQuerySchema,
  type EventListCursor,
  type EventListQuery,
  type EventListQueryInput,
} from "@chronelle/schemas";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
} from "drizzle-orm";

import { decodeCursor, encodeCursor } from "./cursor.js";
import { InvalidObjectStateError } from "./errors.js";
import { readObjectStates } from "./object-state.js";
import type { EventResource } from "./types.js";

export interface EventPage {
  readonly items: EventResource[];
  readonly nextCursor: string | null;
  readonly asOf: string;
}

const schedulePosition = sql`coalesce(${events.startsAt}, ${events.startsOn}::timestamp AT TIME ZONE 'UTC')`;

const foldedName = sql<string>`lower(${objects.displayName}) COLLATE "C"`;

function eventOrder(
  sort: EventListQuery["sort"],
  cursor: EventListCursor | undefined,
) {
  const afterName =
    cursor === undefined
      ? undefined
      : or(
          gt(foldedName, cursor.name),
          and(eq(foldedName, cursor.name), gt(objects.id, cursor.id)),
        );
  switch (sort) {
    case "name":
      return { order: [asc(foldedName), asc(objects.id)], after: afterName };
    case "updated": {
      const time = sql`${cursor?.updatedAt}::timestamptz`;
      return {
        order: [desc(objects.updatedAt), asc(objects.id)],
        after:
          cursor === undefined
            ? undefined
            : or(
                lt(objects.updatedAt, time),
                and(eq(objects.updatedAt, time), gt(objects.id, cursor.id)),
              ),
      };
    }
    case "date": {
      const time = sql`${cursor?.startsAt}::timestamptz`;
      const after =
        cursor?.startsAt === null
          ? and(isNull(schedulePosition), afterName)
          : or(
              isNull(schedulePosition),
              gt(schedulePosition, time),
              and(eq(schedulePosition, time), afterName),
            );
      return {
        order: [
          sql`${schedulePosition} ASC NULLS LAST`,
          asc(foldedName),
          asc(objects.id),
        ],
        after: cursor === undefined ? undefined : after,
      };
    }
  }
}

function periodPredicate(filter: EventListQuery["filter"], asOf: string) {
  if (filter === "all") return undefined;
  if (filter === "unscheduled") return isNull(schedulePosition);
  const end = sql`coalesce(${events.endsAt}, ${events.startsAt})`;
  const calendarEnd = sql`coalesce(${events.endsOn}, ${events.startsOn})`;
  const today = sql`(${asOf}::timestamptz AT TIME ZONE coalesce(${events.timezone}, 'UTC'))::date`;
  return or(
    and(
      isNotNull(events.startsOn),
      filter === "past"
        ? sql`${calendarEnd} < ${today}`
        : sql`${calendarEnd} >= ${today}`,
    ),
    and(
      isNotNull(events.startsAt),
      filter === "past"
        ? sql`${end} < ${asOf}::timestamptz`
        : sql`${end} >= ${asOf}::timestamptz`,
    ),
  );
}

function readPosition(
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

export async function listEventPage(
  database: AuthorizationDatabase,
  principal: UserPrincipal,
  options: EventListQueryInput = {},
): Promise<EventPage> {
  const input = eventListQuerySchema.parse(options);
  const context = createHash("sha256")
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
  const cursor = readPosition(input.cursor, context);
  // Period membership is stable across pages; authorization uses its own fresh clock.
  const asOf = cursor?.asOf ?? new Date().toISOString().replace("Z", "000Z");
  const { order, after } = eventOrder(input.sort, cursor);
  const pattern = `%${input.query.replace(/[\\%_]/g, "\\$&")}%`;

  return withReadAuthorization(database, async (transaction, authorization) => {
    const rows = await transaction
      .select({
        id: objects.id,
        name: foldedName,
        // API dates use milliseconds; keyset positions retain database precision.
        startsAt: sql<
          string | null
        >`to_char(${schedulePosition} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
        updatedAt: sql<string>`to_char(${objects.updatedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      })
      .from(objects)
      .innerJoin(
        events,
        and(
          eq(events.objectId, objects.id),
          eq(events.workspaceId, objects.workspaceId),
        ),
      )
      .where(
        and(
          eq(objects.objectType, "event"),
          eq(objects.permissionScopeId, objects.id),
          authorization.resourcePredicate(principal, "view"),
          input.query === "" ? undefined : ilike(objects.displayName, pattern),
          periodPredicate(input.filter, asOf),
          after,
        ),
      )
      .orderBy(...order)
      .limit(input.limit + 1);
    const page = rows.slice(0, input.limit);
    // The IDs were authorized in this same read-only snapshot; hydrate only this page.
    const states =
      page.length === 0
        ? []
        : await readObjectStates(
            transaction,
            and(
              eq(objects.workspaceId, principal.workspaceId),
              inArray(
                objects.id,
                page.map(({ id }) => id),
              ),
            ),
            input.limit,
          );
    const byId = new Map(states.map((state) => [state.id, state]));
    const items = page.map(({ id }) => {
      const event = byId.get(id);
      if (event?.objectType !== "event")
        throw new InvalidObjectStateError(
          "The canonical Event state is missing.",
        );
      return event;
    });
    const last = page.at(-1);
    return {
      items,
      asOf,
      nextCursor:
        rows.length > input.limit && last !== undefined
          ? encodeCursor({
              formatVersion: 1,
              context,
              asOf,
              ...last,
            } satisfies EventListCursor)
          : null,
    };
  });
}
