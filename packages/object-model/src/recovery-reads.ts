import { createHash } from "node:crypto";
import {
  AuthorizationDeniedError,
  withReadAuthorization,
  type UserPrincipal,
} from "@chronelle/authorization";
import {
  objects,
  type Database,
  type DatabaseTransaction,
  type ObjectType,
} from "@chronelle/db";
import {
  trashCursorSchema,
  trashQuerySchema,
  type TrashQuery,
  type TrashQueryInput,
} from "@chronelle/schemas";
import { and, desc, eq, isNotNull, lt } from "drizzle-orm";

import { decodeCursor, encodeCursor } from "./cursor.js";
import { InvalidObjectStateError } from "./errors.js";
import { readObjectState } from "./object-state.js";

export interface TrashItem {
  readonly id: string;
  readonly objectType: ObjectType;
  readonly displayName: string;
  readonly version: number;
  readonly deletedAt: string;
}

export interface TrashPage {
  readonly items: TrashItem[];
  readonly nextCursor: string | null;
}

export interface RecoveryPreview {
  readonly object: TrashItem;
  readonly canRecover: boolean;
  readonly blockedReason: string | null;
}

/**
 * Read boundary for Trash. Implementations list the tombstones the principal
 * may recover, newest id first, and preview one tombstone together with the
 * canonical scope condition that blocks its recovery.
 */
export interface RecoveryReadRepository {
  listTrash(
    principal: UserPrincipal,
    input?: TrashQueryInput,
  ): Promise<TrashPage>;
  previewRecovery(
    principal: UserPrincipal,
    objectId: string,
  ): Promise<RecoveryPreview>;
}

export const recoveryBlockedByScopeReason =
  "Restore the canonical permission scope first. Recovery does not change permissions.";

/** Query identity a Trash cursor is bound to; a cursor from another query is rejected. */
export function trashListContext(
  principal: UserPrincipal,
  input: TrashQuery,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        "trash",
        principal.userId,
        principal.workspaceId,
        input.objectType ?? null,
        input.scopeId ?? null,
      ]),
    )
    .digest("hex");
}

export function readTrashCursor(token: string | undefined, context: string) {
  if (token === undefined) return undefined;
  try {
    const cursor = trashCursorSchema.parse(decodeCursor(token));
    if (cursor.context === context) return cursor;
  } catch {
    // Invalid encoding, shape, and context have the same public failure.
  }
  throw new InvalidObjectStateError(
    "The Trash cursor is invalid for this query.",
  );
}

export function trashCursor(context: string, id: string): string {
  return encodeCursor({ formatVersion: 1, context, id });
}

/** Recovery is blocked while the inherited canonical scope is itself missing or in Trash. */
export async function recoveryBlockedReason(
  transaction: DatabaseTransaction,
  workspaceId: string,
  scopeId: string,
  objectId: string,
): Promise<string | null> {
  if (scopeId === objectId) return null;
  const [scope] = await transaction
    .select({ deletedAt: objects.deletedAt })
    .from(objects)
    .where(and(eq(objects.workspaceId, workspaceId), eq(objects.id, scopeId)))
    .limit(1);
  return scope === undefined || scope.deletedAt !== null
    ? recoveryBlockedByScopeReason
    : null;
}

const trashFields = {
  id: objects.id,
  objectType: objects.objectType,
  displayName: objects.displayName,
  version: objects.version,
  deletedAt: objects.deletedAt,
};

export class PostgresRecoveryReadRepository implements RecoveryReadRepository {
  readonly #database: Database;

  constructor(database: Database) {
    this.#database = database;
  }

  async listTrash(
    principal: UserPrincipal,
    options: TrashQueryInput = {},
  ): Promise<TrashPage> {
    const input = trashQuerySchema.parse(options);
    const context = trashListContext(principal, input);
    const cursor = readTrashCursor(input.cursor, context);
    return withReadAuthorization(
      this.#database,
      async (transaction, authorization) => {
        const rows = await transaction
          .select(trashFields)
          .from(objects)
          .where(
            and(
              authorization.resourcePredicate(principal, "recover"),
              isNotNull(objects.deletedAt),
              input.objectType === undefined
                ? undefined
                : eq(objects.objectType, input.objectType),
              input.scopeId === undefined
                ? undefined
                : eq(objects.permissionScopeId, input.scopeId),
              cursor === undefined ? undefined : lt(objects.id, cursor.id),
            ),
          )
          .orderBy(desc(objects.id))
          .limit(input.limit + 1);
        const items = rows.slice(0, input.limit).map((row) => {
          if (row.deletedAt === null)
            throw new InvalidObjectStateError("Expected a deleted object.");
          return { ...row, deletedAt: row.deletedAt.toISOString() };
        });
        const last = items.at(-1);
        return {
          items,
          nextCursor:
            rows.length > input.limit && last !== undefined
              ? trashCursor(context, last.id)
              : null,
        };
      },
    );
  }

  async previewRecovery(
    principal: UserPrincipal,
    objectId: string,
  ): Promise<RecoveryPreview> {
    return withReadAuthorization(
      this.#database,
      async (transaction, authorization) => {
        await authorization.assertCan(principal, "recover", {
          id: objectId,
          workspaceId: principal.workspaceId,
        });
        const current = await readObjectState(
          transaction,
          principal.workspaceId,
          objectId,
        );
        if (current.deletedAt === null) throw new AuthorizationDeniedError();
        const blockedReason = await recoveryBlockedReason(
          transaction,
          principal.workspaceId,
          current.permissionScopeId,
          objectId,
        );
        return {
          object: {
            id: current.id,
            objectType: current.objectType,
            displayName: current.displayName,
            version: current.version,
            deletedAt: current.deletedAt.toISOString(),
          },
          canRecover: blockedReason === null,
          blockedReason,
        };
      },
    );
  }
}
