import {
  AuthorizationDeniedError,
  AuthorizationService,
  DrizzleAuthorizationStore,
  type UserPrincipal,
} from "@chronelle/authorization";
import { objectRevisions, type Database } from "@chronelle/db";
import {
  revisionSnapshotSchema,
  type RevisionListQuery,
} from "@chronelle/schemas";
import { and, desc, eq, lt } from "drizzle-orm";

const summaryFields = {
  id: objectRevisions.id,
  objectId: objectRevisions.objectId,
  objectVersion: objectRevisions.objectVersion,
  mutationKind: objectRevisions.mutationKind,
  actorType: objectRevisions.actorType,
  actorId: objectRevisions.actorId,
  createdAt: objectRevisions.createdAt,
  snapshotSchemaVersion: objectRevisions.snapshotSchemaVersion,
};

export class ObjectRevisionService {
  constructor(private readonly database: Database) {}

  async list(
    principal: UserPrincipal,
    objectId: string,
    input: RevisionListQuery,
  ) {
    return this.database.transaction(
      async (transaction) => {
        const authorization = new AuthorizationService(
          new DrizzleAuthorizationStore(transaction),
        );
        await authorization.assertCan(principal, "view", {
          id: objectId,
          workspaceId: principal.workspaceId,
        });
        const rows = await transaction
          .select(summaryFields)
          .from(objectRevisions)
          .where(
            and(
              eq(objectRevisions.workspaceId, principal.workspaceId),
              eq(objectRevisions.objectId, objectId),
              input.beforeVersion === undefined
                ? undefined
                : lt(objectRevisions.objectVersion, input.beforeVersion),
            ),
          )
          .orderBy(desc(objectRevisions.objectVersion))
          .limit(input.limit + 1);
        const items = rows
          .slice(0, input.limit)
          .map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
        return {
          items,
          nextBeforeVersion:
            rows.length > input.limit
              ? (items.at(-1)?.objectVersion ?? null)
              : null,
        };
      },
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
  }

  async get(principal: UserPrincipal, objectId: string, version: number) {
    return this.database.transaction(
      async (transaction) => {
        const authorization = new AuthorizationService(
          new DrizzleAuthorizationStore(transaction),
        );
        await authorization.assertCan(principal, "view", {
          id: objectId,
          workspaceId: principal.workspaceId,
        });
        const [row] = await transaction
          .select({ ...summaryFields, snapshot: objectRevisions.snapshot })
          .from(objectRevisions)
          .where(
            and(
              eq(objectRevisions.workspaceId, principal.workspaceId),
              eq(objectRevisions.objectId, objectId),
              eq(objectRevisions.objectVersion, version),
            ),
          )
          .limit(1);
        if (row === undefined) throw new AuthorizationDeniedError();
        if (row.snapshotSchemaVersion !== 1)
          throw new Error("Unsupported object snapshot schema.");
        return {
          ...row,
          createdAt: row.createdAt.toISOString(),
          snapshot: revisionSnapshotSchema.parse(row.snapshot),
        };
      },
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
  }
}
