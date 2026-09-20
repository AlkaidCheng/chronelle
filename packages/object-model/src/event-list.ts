import { createHash } from "node:crypto";
import {
  withReadAuthorization,
  type AuthorizationDatabase,
  type UserPrincipal,
} from "@chronelle/authorization";
import {
  events,
  objects,
  resourceGrants,
  roles,
  users,
  workspaceMembers,
  type Role,
} from "@chronelle/db";
import {
  eventListCursorSchema,
  eventListQuerySchema,
  type EventListCounts,
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
  type SQL,
} from "drizzle-orm";

import { decodeCursor, encodeCursor } from "./cursor.js";
import { InvalidObjectStateError } from "./errors.js";
import { readObjectStates } from "./object-state.js";
import type { EventResource } from "./types.js";

/**
 * How the account reaches a listed Event: through a share from a workspace
 * it does not belong to (who gave it, the role held), or as its own, with
 * how many accounts hold a grant on it.
 */
export interface EventListAccess {
  readonly sharedBy: {
    readonly userId: string;
    readonly displayName: string;
  } | null;
  readonly role: Role | null;
  readonly sharedWith: number;
}

export interface EventListItem extends EventResource {
  readonly access: EventListAccess;
}

export interface EventPage {
  readonly items: EventListItem[];
  readonly nextCursor: string | null;
  readonly asOf: string;
  /** The chip counts for the query, on the first page only. */
  readonly counts: EventListCounts | null;
}

/** An active grant on a listed Event, as both backends read them. */
export interface EventGrantRow {
  readonly resourceId: string;
  readonly principalId: string;
  readonly role: Role;
  readonly scope: string;
  readonly grantedBy: string;
}

const roleRank: Readonly<Record<Role, number>> = {
  owner: 3,
  editor: 2,
  viewer: 1,
};

/**
 * The access of each listed Event from its active grants and the account's
 * memberships: an Event in a workspace the account belongs to is its own,
 * counting the other accounts granted on it; any other is a share, read
 * through the account's widest grant.
 */
export function eventListAccess(
  event: Pick<EventResource, "id" | "workspaceId">,
  userId: string,
  memberWorkspaceIds: ReadonlySet<string>,
  grants: readonly EventGrantRow[],
  displayNames: ReadonlyMap<string, string>,
): EventListAccess {
  const own = grants.filter((grant) => grant.resourceId === event.id);
  if (memberWorkspaceIds.has(event.workspaceId)) {
    return {
      sharedBy: null,
      role: null,
      sharedWith: new Set(
        own
          .filter((grant) => grant.principalId !== userId)
          .map((grant) => grant.principalId),
      ).size,
    };
  }
  const held = own
    .filter((grant) => grant.principalId === userId)
    .sort(
      (first, second) =>
        Number(second.scope === "all") - Number(first.scope === "all") ||
        roleRank[second.role] - roleRank[first.role],
    );
  const widest = held[0];
  if (widest === undefined)
    return { sharedBy: null, role: null, sharedWith: 0 };
  return {
    sharedBy: {
      userId: widest.grantedBy,
      displayName: displayNames.get(widest.grantedBy) ?? "",
    },
    // A grant narrowed to a view opens the Event to view alone.
    role: widest.scope === "all" ? widest.role : "viewer",
    sharedWith: 0,
  };
}

/**
 * Read boundary for event projections.
 *
 * Implementations own the query strategy and storage protocol; callers only
 * depend on the authorization and pagination contract.
 */
export interface EventReadRepository {
  listEvents(
    principal: UserPrincipal,
    input?: EventListQueryInput,
  ): Promise<EventPage>;
}

export class PostgresEventReadRepository implements EventReadRepository {
  readonly #database: AuthorizationDatabase;

  constructor(database: AuthorizationDatabase) {
    this.#database = database;
  }

  listEvents(
    principal: UserPrincipal,
    input: EventListQueryInput = {},
  ): Promise<EventPage> {
    return listEventPage(this.#database, principal, input);
  }
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
        input.scope,
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
    // The account's own workspace's Events beside the ones shared with it
    // from workspaces it does not belong to; one keyset over both.
    const mine = authorization.memberResourcePredicate(principal);
    const shared = authorization.sharedResourcePredicate(principal);
    const scoped =
      input.scope === "all"
        ? or(mine, shared)
        : input.scope === "mine"
          ? mine
          : shared;
    const rootEvent = and(
      eq(objects.objectType, "event"),
      eq(objects.permissionScopeId, objects.id),
    );
    const matching =
      input.query === "" ? undefined : ilike(objects.displayName, pattern);
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
          rootEvent,
          scoped,
          matching,
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
            inArray(
              objects.id,
              page.map(({ id }) => id),
            ),
            input.limit,
          );
    const byId = new Map(states.map((state) => [state.id, state]));
    const resources = page.map(({ id }) => {
      const event = byId.get(id);
      if (event?.objectType !== "event")
        throw new InvalidObjectStateError(
          "The canonical Event state is missing.",
        );
      return event;
    });
    const items = await withAccess(transaction, principal, resources, asOf);
    // The chips count the whole list once, under the query alone.
    const counts =
      cursor === undefined
        ? await countEvents(
            transaction,
            { rootEvent, mine, shared, matching },
            asOf,
          )
        : null;
    const last = page.at(-1);
    return {
      items,
      asOf,
      counts,
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

type ListTransaction = Parameters<
  Parameters<typeof withReadAuthorization>[1]
>[0];

/** Each Event of the page with its access, read from the grants of the page alone. */
async function withAccess(
  transaction: ListTransaction,
  principal: UserPrincipal,
  resources: readonly EventResource[],
  asOf: string,
): Promise<EventListItem[]> {
  if (resources.length === 0) return [];
  const ids = resources.map((event) => event.id);
  const workspaceIds = [
    ...new Set(resources.map((event) => event.workspaceId)),
  ];
  const [memberships, grants] = await Promise.all([
    transaction
      .select({ workspaceId: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.userId, principal.userId),
          inArray(workspaceMembers.workspaceId, workspaceIds),
        ),
      ),
    transaction
      .select({
        resourceId: resourceGrants.resourceId,
        principalId: resourceGrants.principalId,
        role: resourceGrants.role,
        scope: resourceGrants.scope,
        grantedBy: resourceGrants.grantedBy,
      })
      .from(resourceGrants)
      .where(
        and(
          inArray(resourceGrants.resourceId, ids),
          eq(resourceGrants.principalType, "user"),
          inArray(resourceGrants.role, roles),
          or(
            isNull(resourceGrants.expiresAt),
            gt(resourceGrants.expiresAt, sql`${asOf}::timestamptz`),
          ),
        ),
      ),
  ]);
  const grantorIds = [...new Set(grants.map((grant) => grant.grantedBy))];
  const grantors =
    grantorIds.length === 0
      ? []
      : await transaction
          .select({ id: users.id, displayName: users.displayName })
          .from(users)
          .where(inArray(users.id, grantorIds));
  const memberWorkspaceIds = new Set(memberships.map((row) => row.workspaceId));
  const displayNames = new Map(
    grantors.map((user) => [user.id, user.displayName]),
  );
  return resources.map((event) => ({
    ...event,
    access: eventListAccess(
      event,
      principal.userId,
      memberWorkspaceIds,
      grants,
      displayNames,
    ),
  }));
}

/** The chip counts under the typed query: own and shared Events, and the periods of both. */
async function countEvents(
  transaction: ListTransaction,
  predicates: {
    readonly rootEvent: SQL | undefined;
    readonly mine: SQL;
    readonly shared: SQL;
    readonly matching: SQL | undefined;
  },
  asOf: string,
): Promise<EventListCounts> {
  const count = (condition: SQL | undefined) =>
    sql<number>`count(*) FILTER (WHERE ${condition ?? sql`true`})::int`;
  const [row] = await transaction
    .select({
      mine: count(predicates.mine),
      shared: count(predicates.shared),
      upcoming: count(periodPredicate("upcoming", asOf)),
      past: count(periodPredicate("past", asOf)),
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
        predicates.rootEvent,
        or(predicates.mine, predicates.shared),
        predicates.matching,
      ),
    );
  const mine = row?.mine ?? 0;
  const shared = row?.shared ?? 0;
  return {
    all: mine + shared,
    mine,
    shared,
    upcoming: row?.upcoming ?? 0,
    past: row?.past ?? 0,
  };
}
