import { createHash } from "node:crypto";
import {
  withReadAuthorization,
  type AuthorizationDatabase,
  type UserPrincipal,
} from "@chronelle/authorization";
import { objectRelations, objects } from "@chronelle/db";
import {
  relationListCursorSchema,
  relationListQuerySchema,
  removedRelationQuerySchema,
  type RelationListCursor,
  type RelationListQueryInput,
  type RemovedRelationQuery,
  type RemovedRelationQueryInput,
} from "@chronelle/schemas";
import {
  and,
  desc,
  eq,
  getTableColumns,
  isNull,
  isNotNull,
  lt,
  or,
  sql,
  type SQLWrapper,
} from "drizzle-orm";
import { decodeCursor, encodeCursor } from "./cursor.js";
import { InvalidObjectStateError } from "./errors.js";
import type { ObjectRelationResource } from "./types.js";

type RelationListQuery = ReturnType<typeof relationListQuerySchema.parse>;

export interface RelationPage {
  readonly items: ObjectRelationResource[];
  readonly nextCursor: string | null;
}

export interface RemovedRelationItem {
  readonly relation: ObjectRelationResource;
  readonly sourceDisplayName: string;
  readonly targetDisplayName: string;
}

export interface RemovedRelationPage {
  readonly items: RemovedRelationItem[];
  readonly nextCursor: string | null;
}

/**
 * Read boundary for an object's relation pages. Implementations authorize the
 * object, hide relations whose other endpoint the principal cannot view, and
 * page newest-first by relation id with the shared cursor envelope.
 */
export interface RelationReadRepository {
  listRelations(
    principal: UserPrincipal,
    objectId: string,
    input?: RelationListQueryInput,
  ): Promise<RelationPage>;
  /** Removed links with a live editable source and a live readable target. */
  listRemovedRelations(
    principal: UserPrincipal,
    objectId: string,
    input: RemovedRelationQueryInput,
  ): Promise<RemovedRelationPage>;
}

export class PostgresRelationReadRepository implements RelationReadRepository {
  readonly #database: AuthorizationDatabase;

  constructor(database: AuthorizationDatabase) {
    this.#database = database;
  }

  listRelations(
    principal: UserPrincipal,
    objectId: string,
    input: RelationListQueryInput = {},
  ): Promise<RelationPage> {
    return listRelationPage(this.#database, principal, objectId, input);
  }

  listRemovedRelations(
    principal: UserPrincipal,
    objectId: string,
    input: RemovedRelationQueryInput,
  ): Promise<RemovedRelationPage> {
    return listRemovedRelationPage(this.#database, principal, objectId, input);
  }
}

/** Query identity a relation cursor is bound to; a cursor from another query is rejected. */
export function relationListContext(
  principal: UserPrincipal,
  objectId: string,
  input: RelationListQuery,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        principal.userId,
        principal.workspaceId,
        objectId,
        input.direction,
        input.relationType ?? null,
        input.otherObjectId ?? null,
      ]),
    )
    .digest("hex");
}

export function removedRelationContext(
  principal: UserPrincipal,
  objectId: string,
  input: RemovedRelationQuery,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        "removed-relations",
        principal.userId,
        principal.workspaceId,
        objectId,
        input.relationType ?? null,
      ]),
    )
    .digest("hex");
}

export function readRelationCursor(
  token: string | undefined,
  context: string,
): RelationListCursor | undefined {
  if (token === undefined) return undefined;
  try {
    const cursor = relationListCursorSchema.parse(decodeCursor(token));
    if (cursor.context === context) return cursor;
  } catch {
    // Invalid encoding, shape, and context have the same public failure.
  }
  throw new InvalidObjectStateError(
    "The relation cursor is invalid for this query.",
  );
}

export function relationCursor(context: string, id: string): string {
  return encodeCursor({
    formatVersion: 1,
    context,
    id,
  } satisfies RelationListCursor);
}

export async function listRelationPage(
  database: AuthorizationDatabase,
  principal: UserPrincipal,
  objectId: string,
  options: RelationListQueryInput = {},
): Promise<RelationPage> {
  const input = relationListQuerySchema.parse(options);
  const context = relationListContext(principal, objectId, input);
  const cursor = readRelationCursor(input.cursor, context);
  const outgoing = eq(objectRelations.sourceObjectId, objectId);
  const incoming = eq(objectRelations.targetObjectId, objectId);
  const direction =
    input.direction === "both"
      ? or(outgoing, incoming)
      : input.direction === "outgoing"
        ? outgoing
        : incoming;

  return withReadAuthorization(database, async (transaction, authorization) => {
    await authorization.assertCan(principal, "view", {
      id: objectId,
      workspaceId: principal.workspaceId,
    });
    const otherObjectId =
      input.direction === "outgoing"
        ? objectRelations.targetObjectId
        : input.direction === "incoming"
          ? objectRelations.sourceObjectId
          : sql`CASE WHEN ${outgoing}
          THEN ${objectRelations.targetObjectId} ELSE ${objectRelations.sourceObjectId} END`;
    const visibleEndpoint = transaction
      .select({ id: objects.id })
      .from(objects)
      .where(
        and(
          eq(objects.id, otherObjectId),
          authorization.resourcePredicate(principal, "view"),
        ),
      )
      // Keep the lookup parameterized by endpoint, even with stale table statistics.
      .limit(1)
      .as("visible_endpoint");
    const rows = await transaction
      .select(getTableColumns(objectRelations))
      .from(objectRelations)
      .innerJoinLateral(visibleEndpoint, sql`true`)
      .where(
        and(
          eq(objectRelations.workspaceId, principal.workspaceId),
          isNull(objectRelations.deletedAt),
          direction,
          input.relationType === undefined
            ? undefined
            : eq(objectRelations.relationType, input.relationType),
          input.otherObjectId === undefined
            ? undefined
            : eq(sql`${otherObjectId}`, input.otherObjectId),
          cursor === undefined ? undefined : lt(objectRelations.id, cursor.id),
        ),
      )
      .orderBy(desc(objectRelations.id))
      .limit(input.limit + 1);
    const items = rows.slice(0, input.limit);
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        rows.length > input.limit && last !== undefined
          ? relationCursor(context, last.id)
          : null,
    };
  });
}

/** List removed links with a live editable source and a live readable target. */
export async function listRemovedRelationPage(
  database: AuthorizationDatabase,
  principal: UserPrincipal,
  objectId: string,
  options: RemovedRelationQueryInput,
): Promise<RemovedRelationPage> {
  const input = removedRelationQuerySchema.parse(options);
  const context = removedRelationContext(principal, objectId, input);
  const cursor = readRelationCursor(input.cursor, context);
  return withReadAuthorization(database, async (transaction, authorization) => {
    await authorization.assertCan(principal, "view", {
      id: objectId,
      workspaceId: principal.workspaceId,
    });
    const endpoint = (id: SQLWrapper, action: "edit" | "view") =>
      transaction
        .select({ displayName: objects.displayName })
        .from(objects)
        .where(
          and(
            eq(objects.id, id),
            authorization.resourcePredicate(principal, action),
          ),
        )
        .limit(1);
    const source = endpoint(objectRelations.sourceObjectId, "edit").as(
      "editable_source",
    );
    const target = endpoint(objectRelations.targetObjectId, "view").as(
      "readable_target",
    );
    const rows = await transaction
      .select({
        relation: getTableColumns(objectRelations),
        sourceDisplayName: source.displayName,
        targetDisplayName: target.displayName,
      })
      .from(objectRelations)
      .innerJoinLateral(source, sql`true`)
      .innerJoinLateral(target, sql`true`)
      .where(
        and(
          eq(objectRelations.workspaceId, principal.workspaceId),
          isNotNull(objectRelations.deletedAt),
          or(
            eq(objectRelations.sourceObjectId, objectId),
            eq(objectRelations.targetObjectId, objectId),
          ),
          input.relationType === undefined
            ? undefined
            : eq(objectRelations.relationType, input.relationType),
          cursor === undefined ? undefined : lt(objectRelations.id, cursor.id),
        ),
      )
      .orderBy(desc(objectRelations.id))
      .limit(input.limit + 1);
    const items = rows.slice(0, input.limit);
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        rows.length > input.limit && last !== undefined
          ? relationCursor(context, last.relation.id)
          : null,
    };
  });
}
