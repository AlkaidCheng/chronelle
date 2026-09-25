import {
  AuthorizationService,
  DrizzleAuthorizationStore,
  withReadAuthorization,
  type UserPrincipal,
} from "@livtales/authorization";
import {
  documents,
  documentTransferAuthorizations as transfers,
  objectRevisions,
  objects,
  type Database,
} from "@livtales/db";
import { objectIdParamsSchema } from "@livtales/schemas";
import { StorageInventoryUnavailableError } from "@livtales/storage";
import { and, eq, sql } from "drizzle-orm";

/** The storage keys a workspace references, classified for one provider. */
export interface StorageReferences {
  /** Keys of live documents stored with the provider. */
  readonly canonical: Set<string>;
  /** Keys named only by document revision snapshots for the provider. */
  readonly historical: Set<string>;
  /** Keys of upload transfers, true while an upload can still finalize. */
  readonly uploads: Map<string, boolean>;
}

/** The rows the references are classified from, each set capped at one more than the bound. */
export interface StorageReferenceRows {
  readonly canonical: readonly string[];
  readonly revisions: readonly {
    readonly schemaVersion: number;
    readonly objectType: string | null;
    readonly provider: string | null;
    readonly key: string | null;
  }[];
  readonly uploads: readonly {
    readonly key: string;
    readonly recoverable: boolean;
  }[];
}

/**
 * Read boundary for the storage inventory: the workspace Owner check and
 * the referenced storage keys of one provider. Implementations refuse any
 * principal who is not an Owner, and refuse a workspace whose reference
 * sets exceed the inventory bound.
 */
export interface StorageInventoryReadRepository {
  assertWorkspaceOwner(principal: UserPrincipal): Promise<void>;
  loadReferences(
    principal: UserPrincipal,
    providerId: string,
    observedAt: Date,
    maximumEntries: number,
  ): Promise<StorageReferences>;
}

export function isDocumentKey(key: string, prefix: string): boolean {
  return (
    key.startsWith(`${prefix}/`) &&
    objectIdParamsSchema.safeParse({ id: key.slice(prefix.length + 1) }).success
  );
}

export function documentPrefix(workspaceId: string): string {
  return `workspaces/${workspaceId}/documents`;
}

/** Classifies the rows for one provider; any malformed reference or an oversized set is a refusal. */
export function classifyReferences(
  rows: StorageReferenceRows,
  providerId: string,
  prefix: string,
  maximumEntries: number,
): StorageReferences {
  if (
    [rows.canonical, rows.revisions, rows.uploads].some(
      (set) => set.length > maximumEntries,
    )
  )
    throw new StorageInventoryUnavailableError();
  const canonical = new Set(rows.canonical);
  const historical = new Set<string>();
  for (const row of rows.revisions) {
    if (
      row.schemaVersion !== 1 ||
      row.objectType !== "document" ||
      !row.provider?.trim() ||
      row.key === null ||
      !isDocumentKey(row.key, prefix)
    ) {
      throw new StorageInventoryUnavailableError();
    }
    if (row.provider === providerId && !canonical.has(row.key))
      historical.add(row.key);
  }
  const uploads = new Map(
    rows.uploads.map((row) => [row.key, row.recoverable]),
  );
  const allKeys = new Set([...canonical, ...historical, ...uploads.keys()]);
  if (
    allKeys.size > maximumEntries ||
    [...allKeys].some((key) => !isDocumentKey(key, prefix))
  )
    throw new StorageInventoryUnavailableError();
  return { canonical, historical, uploads };
}

export class PostgresStorageInventoryReadRepository implements StorageInventoryReadRepository {
  readonly #database: Database;
  readonly #authorization: AuthorizationService;

  constructor(database: Database) {
    this.#database = database;
    this.#authorization = new AuthorizationService(
      new DrizzleAuthorizationStore(database),
    );
  }

  async assertWorkspaceOwner(principal: UserPrincipal): Promise<void> {
    await this.#authorization.assertWorkspaceOwner(principal);
  }

  async loadReferences(
    principal: UserPrincipal,
    providerId: string,
    observedAt: Date,
    maximumEntries: number,
  ): Promise<StorageReferences> {
    return withReadAuthorization(
      this.#database,
      async (transaction, authorization) => {
        await transaction.execute(sql`set local statement_timeout = '5s'`);
        await authorization.assertWorkspaceOwner(principal);
        const canonicalRows = await transaction
          .selectDistinct({ key: documents.storageKey })
          .from(documents)
          .where(
            and(
              eq(documents.workspaceId, principal.workspaceId),
              eq(documents.storageProvider, providerId),
            ),
          )
          .limit(maximumEntries + 1);
        const revisionRows = await transaction
          .selectDistinct({
            schemaVersion: objectRevisions.snapshotSchemaVersion,
            objectType: sql<
              string | null
            >`${objectRevisions.snapshot}->>'objectType'`,
            provider: sql<
              string | null
            >`case when jsonb_typeof(${objectRevisions.snapshot}->'storageProvider') = 'string' then ${objectRevisions.snapshot}->>'storageProvider' end`,
            key: sql<string | null>`${objectRevisions.snapshot}->>'storageKey'`,
          })
          .from(objectRevisions)
          .innerJoin(
            objects,
            and(
              eq(objects.id, objectRevisions.objectId),
              eq(objects.workspaceId, objectRevisions.workspaceId),
              eq(objects.objectType, "document"),
            ),
          )
          .where(eq(objectRevisions.workspaceId, principal.workspaceId))
          .limit(maximumEntries + 1);
        const uploadRows = await transaction
          .select({
            key: transfers.storageKey,
            recoverable: sql<boolean>`bool_or(${transfers.consumedAt} is not null or ${transfers.finalizedAt} is not null or ${transfers.expiresAt} > ${observedAt.toISOString()}::timestamptz)`,
          })
          .from(transfers)
          .where(
            and(
              eq(transfers.workspaceId, principal.workspaceId),
              eq(transfers.storageProvider, providerId),
              eq(transfers.operation, "upload"),
            ),
          )
          .groupBy(transfers.storageKey)
          .limit(maximumEntries + 1);
        return classifyReferences(
          {
            canonical: canonicalRows.map((row) => row.key),
            revisions: revisionRows,
            uploads: uploadRows,
          },
          providerId,
          documentPrefix(principal.workspaceId),
          maximumEntries,
        );
      },
    );
  }
}
