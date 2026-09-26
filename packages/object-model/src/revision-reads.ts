import {
  AuthorizationDeniedError,
  withReadAuthorization,
  type UserPrincipal,
} from "@livtales/authorization";
import {
  objectRevisions,
  users,
  type ActorType,
  type Database,
  type RevisionKind,
} from "@livtales/db";
import {
  revisionSnapshotSchema,
  type RevisionFieldChange,
  type RevisionListQuery,
  type RevisionSnapshot,
} from "@livtales/schemas";
import { and, desc, eq, lt } from "drizzle-orm";

import { InvalidObjectStateError } from "./errors.js";
import {
  compareRevisionContent,
  initialRevisionContent,
} from "./restoration-policy.js";

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
  /** Up to three content fields that differ from the previous revision. */
  readonly changedFields: readonly RevisionFieldChange[];
  /** Every content field that differs from the previous revision. */
  readonly changedFieldCount: number;
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

/** The change summary shown on a history row, from the previous revision's snapshot. */
export const revisionSummaryFieldLimit = 3;

/** Both backends summarize a row the same way: `changedFields` is the first
 * three differences and `changedFieldCount` all of them; the first revision
 * lists the content it started with, and one whose snapshot cannot be read
 * summarizes as unchanged. */
export function summarizeRevisionChanges(
  previous: { schemaVersion: number; snapshot: unknown } | undefined,
  current: { schemaVersion: number; snapshot: unknown },
): Pick<RevisionSummary, "changedFields" | "changedFieldCount"> {
  let changes: RevisionFieldChange[];
  try {
    const snapshot = decodeRevisionSnapshot(
      current.schemaVersion,
      current.snapshot,
    );
    changes =
      previous === undefined
        ? initialRevisionContent(snapshot)
        : compareRevisionContent(
            decodeRevisionSnapshot(previous.schemaVersion, previous.snapshot),
            snapshot,
          );
  } catch {
    return { changedFields: [], changedFieldCount: 0 };
  }
  return {
    changedFields: changes.slice(0, revisionSummaryFieldLimit),
    changedFieldCount: changes.length,
  };
}

export function decodeRevisionSnapshot(
  snapshotSchemaVersion: number,
  snapshot: unknown,
): RevisionSnapshot {
  if (snapshotSchemaVersion !== 1)
    throw new InvalidObjectStateError(
      "The revision snapshot schema is not supported.",
    );
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
              eq(objectRevisions.objectId, objectId),
              input.beforeVersion === undefined
                ? undefined
                : lt(objectRevisions.objectVersion, input.beforeVersion),
            ),
          )
          .orderBy(desc(objectRevisions.objectVersion))
          .limit(input.limit + 2);
        const items = rows.slice(0, input.limit).map((row, index) => {
          const { snapshot, ...summary } = row;
          const previous = rows[index + 1];
          return {
            ...summary,
            createdAt: row.createdAt.toISOString(),
            ...summarizeRevisionChanges(
              previous === undefined
                ? undefined
                : {
                    schemaVersion: previous.snapshotSchemaVersion,
                    snapshot: previous.snapshot,
                  },
              { schemaVersion: row.snapshotSchemaVersion, snapshot },
            ),
          };
        });
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
              eq(objectRevisions.objectId, objectId),
              eq(objectRevisions.objectVersion, version),
            ),
          )
          .limit(1);
        if (row === undefined) throw new AuthorizationDeniedError();
        const [previous] = await transaction
          .select({
            snapshotSchemaVersion: objectRevisions.snapshotSchemaVersion,
            snapshot: objectRevisions.snapshot,
          })
          .from(objectRevisions)
          .where(
            and(
              eq(objectRevisions.objectId, objectId),
              lt(objectRevisions.objectVersion, version),
            ),
          )
          .orderBy(desc(objectRevisions.objectVersion))
          .limit(1);
        return {
          ...row,
          createdAt: row.createdAt.toISOString(),
          ...summarizeRevisionChanges(
            previous === undefined
              ? undefined
              : {
                  schemaVersion: previous.snapshotSchemaVersion,
                  snapshot: previous.snapshot,
                },
            {
              schemaVersion: row.snapshotSchemaVersion,
              snapshot: row.snapshot,
            },
          ),
          snapshot: decodeRevisionSnapshot(
            row.snapshotSchemaVersion,
            row.snapshot,
          ),
        };
      },
    );
  }
}
