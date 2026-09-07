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
  type RelationListCursor,
  type RelationListQueryInput,
} from "@chronelle/schemas";
import {
  and,
  desc,
  eq,
  getTableColumns,
  isNull,
  lt,
  or,
  sql,
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
