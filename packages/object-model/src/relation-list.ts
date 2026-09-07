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

export interface RelationPage {
  readonly items: ObjectRelationResource[];
  readonly nextCursor: string | null;
}

function readPosition(token: string | undefined, context: string) {
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

export async function listRelationPage(
  database: AuthorizationDatabase,
  principal: UserPrincipal,
  objectId: string,
  options: RelationListQueryInput = {},
): Promise<RelationPage> {
  const input = relationListQuerySchema.parse(options);
  const context = createHash("sha256")
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
  const cursor = readPosition(input.cursor, context);
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
          ? encodeCursor({
              formatVersion: 1,
              context,
              id: last.id,
            } satisfies RelationListCursor)
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
) {
  const input = removedRelationQuerySchema.parse(options);
  const context = createHash("sha256")
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
  const cursor = readPosition(input.cursor, context);
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
          ? encodeCursor({
              formatVersion: 1,
              context,
              id: last.relation.id,
            } satisfies RelationListCursor)
          : null,
    };
  });
}
