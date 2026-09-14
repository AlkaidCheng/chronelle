import {
  AuthorizationDeniedError,
  withReadAuthorization,
  type UserPrincipal,
} from "@chronelle/authorization";
import {
  objectRevisions,
  users,
  type ActorType,
  type Database,
  type RevisionKind,
} from "@chronelle/db";
import {
  revisionSnapshotSchema,
  type RevisionListQuery,
  type RevisionSnapshot,
} from "@chronelle/schemas";
import { and, desc, eq, lt } from "drizzle-orm";

export interface RevisionSummary {
  readonly id: string;
  readonly objectId: string;
  readonly objectVersion: number;
  readonly mutationKind: RevisionKind;
  readonly actorType: ActorType;
  readonly actorId: string | null;
  readonly actorDisplayName: string | null;
  readonly createdAt: string;
  readonly snapshotSchemaVersion: number;
  readonly sourceRevisionId: string | null;
}

export interface RevisionPage {
  readonly items: RevisionSummary[];
  readonly nextBeforeVersion: number | null;
}

export interface RevisionDetail extends RevisionSummary {
  readonly snapshot: RevisionSnapshot;
}

/**
 * Read boundary for an object's revision history. Implementations require
 * view access to the live object, page newest version first, and decode the
 * snapshot only for a single revision.
 */
export interface RevisionReadRepository {
  listRevisions(
    principal: UserPrincipal,
    objectId: string,
    input: RevisionListQuery,
  ): Promise<RevisionPage>;
  getRevision(
    principal: UserPrincipal,
    objectId: string,
    version: number,
  ): Promise<RevisionDetail>;
}

export function decodeRevisionSnapshot(
  snapshotSchemaVersion: number,
  snapshot: unknown,
): RevisionSnapshot {
  if (snapshotSchemaVersion !== 1)
    throw new Error("Unsupported object snapshot schema.");
  return revisionSnapshotSchema.parse(snapshot);
}

const summaryFields = {
  id: objectRevisions.id,
  objectId: objectRevisions.objectId,
  objectVersion: objectRevisions.objectVersion,
  mutationKind: objectRevisions.mutationKind,
  actorType: objectRevisions.actorType,
  actorId: objectRevisions.actorId,
  actorDisplayName: users.displayName,
  createdAt: objectRevisions.createdAt,
  snapshotSchemaVersion: objectRevisions.snapshotSchemaVersion,
  sourceRevisionId: objectRevisions.sourceRevisionId,
};

export class PostgresRevisionReadRepository implements RevisionReadRepository {
  readonly #database: Database;

  constructor(database: Database) {
    this.#database = database;
  }

  async listRevisions(
    principal: UserPrincipal,
    objectId: string,
    input: RevisionListQuery,
  ): Promise<RevisionPage> {
    return withReadAuthorization(
      this.#database,
      async (transaction, authorization) => {
        await authorization.assertCan(principal, "view", {
          id: objectId,
          workspaceId: principal.workspaceId,
        });
        const rows = await transaction
          .select(summaryFields)
          .from(objectRevisions)
          .leftJoin(
            users,
            and(
              eq(users.id, objectRevisions.actorId),
              eq(objectRevisions.actorType, "user"),
            ),
          )
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
    );
  }

  async getRevision(
    principal: UserPrincipal,
    objectId: string,
    version: number,
  ): Promise<RevisionDetail> {
    return withReadAuthorization(
      this.#database,
      async (transaction, authorization) => {
        await authorization.assertCan(principal, "view", {
          id: objectId,
          workspaceId: principal.workspaceId,
        });
        const [row] = await transaction
          .select({ ...summaryFields, snapshot: objectRevisions.snapshot })
          .from(objectRevisions)
          .leftJoin(
            users,
            and(
              eq(users.id, objectRevisions.actorId),
              eq(objectRevisions.actorType, "user"),
            ),
          )
          .where(
            and(
              eq(objectRevisions.workspaceId, principal.workspaceId),
              eq(objectRevisions.objectId, objectId),
              eq(objectRevisions.objectVersion, version),
            ),
          )
          .limit(1);
        if (row === undefined) throw new AuthorizationDeniedError();
        return {
          ...row,
          createdAt: row.createdAt.toISOString(),
          snapshot: decodeRevisionSnapshot(
            row.snapshotSchemaVersion,
            row.snapshot,
          ),
        };
      },
    );
  }
}
