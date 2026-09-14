import { createHash } from "node:crypto";
import {
  AuthorizationDeniedError,
  withReadAuthorization,
  withStableAuthorization,
  type UserPrincipal,
} from "@chronelle/authorization";
import {
  objects,
  type Database,
  type DatabaseTransaction,
} from "@chronelle/db";
import {
  trashCursorSchema,
  trashQuerySchema,
  type RecoveryRequest,
  type TrashQueryInput,
} from "@chronelle/schemas";
import { and, desc, eq, isNotNull, lt, sql } from "drizzle-orm";
import { InvalidObjectStateError, ObjectConflictError } from "./errors.js";
import type { ObjectLifecycleWriteRepository } from "./object-writes.js";
import { readObjectState } from "./object-state.js";
import { recordObjectRevision } from "./object-revisions.js";
import type { MutationContext } from "./types.js";
import { decodeCursor, encodeCursor } from "./cursor.js";

function readPosition(token: string | undefined, context: string) {
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

const trashFields = {
  id: objects.id,
  objectType: objects.objectType,
  displayName: objects.displayName,
  version: objects.version,
  deletedAt: objects.deletedAt,
};

/** Recover canonical tombstones without replaying content or changing relationships. */
export class ObjectRecoveryService {
  readonly #database: Database;
  readonly #writes: ObjectLifecycleWriteRepository | undefined;

  constructor(database: Database, writes?: ObjectLifecycleWriteRepository) {
    this.#database = database;
    this.#writes = writes;
  }

  async list(principal: UserPrincipal, options: TrashQueryInput = {}) {
    const input = trashQuerySchema.parse(options);
    const context = createHash("sha256")
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
    const cursor = readPosition(input.cursor, context);
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
              ? encodeCursor({ formatVersion: 1, context, id: last.id })
              : null,
        };
      },
    );
  }

  async preview(principal: UserPrincipal, objectId: string) {
    return withReadAuthorization(
      this.#database,
      async (transaction, authorization) => {
        await authorization.assertCan(principal, "recover", {
          id: objectId,
          workspaceId: principal.workspaceId,
        });
        const current = await this.#readDeleted(
          transaction,
          principal,
          objectId,
        );
        const blockedReason = await this.#blockedReason(
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

  async recover(
    context: MutationContext,
    objectId: string,
    input: RecoveryRequest,
  ) {
    const { principal } = context;
    if (this.#writes !== undefined)
      return this.#writes.recover(context, objectId, input.expectedVersion);
    return withStableAuthorization(
      this.#database,
      principal.workspaceId,
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
        if (current.version !== input.expectedVersion)
          throw new ObjectConflictError();
        if (current.deletedAt === null)
          throw new InvalidObjectStateError("The object is not in Trash.");
        const blockedReason = await this.#blockedReason(
          transaction,
          principal.workspaceId,
          current.permissionScopeId,
          objectId,
        );
        if (blockedReason !== null)
          throw new InvalidObjectStateError(blockedReason);
        const [updated] = await transaction
          .update(objects)
          .set({
            deletedAt: null,
            updatedAt: new Date(),
            version: sql`${objects.version} + 1`,
          })
          .where(
            and(
              eq(objects.workspaceId, principal.workspaceId),
              eq(objects.id, objectId),
              eq(objects.version, input.expectedVersion),
              isNotNull(objects.deletedAt),
            ),
          )
          .returning({ id: objects.id });
        if (updated === undefined) throw new ObjectConflictError();
        return recordObjectRevision(
          transaction,
          await readObjectState(transaction, principal.workspaceId, objectId),
          {
            actorType: "user",
            actorId: principal.userId,
            requestId: context.requestId,
          },
          "recovered",
          {
            previousVersion: current.version,
            deletedAt: current.deletedAt.toISOString(),
          },
        );
      },
    );
  }

  async #readDeleted(
    transaction: DatabaseTransaction,
    principal: UserPrincipal,
    objectId: string,
  ) {
    const current = await readObjectState(
      transaction,
      principal.workspaceId,
      objectId,
    );
    if (current.deletedAt === null) throw new AuthorizationDeniedError();
    return { ...current, deletedAt: current.deletedAt };
  }

  async #blockedReason(
    transaction: DatabaseTransaction,
    workspaceId: string,
    scopeId: string,
    objectId: string,
  ) {
    if (scopeId === objectId) return null;
    const [scope] = await transaction
      .select({ deletedAt: objects.deletedAt })
      .from(objects)
      .where(and(eq(objects.workspaceId, workspaceId), eq(objects.id, scopeId)))
      .limit(1);
    return scope === undefined || scope.deletedAt !== null
      ? "Restore the canonical permission scope first. Recovery does not change permissions."
      : null;
  }
}
