import {
  AuthorizationDeniedError,
  AuthorizationService,
  DrizzleAuthorizationStore,
  withReadAuthorization,
  type UserPrincipal,
} from "@chronelle/authorization";
import {
  documents,
  documentTransferAuthorizations as transfers,
  objectRevisions,
  objects,
  type Database,
} from "@chronelle/db";
import {
  objectIdParamsSchema,
  type StorageInventoryResponse,
} from "@chronelle/schemas";
import {
  StorageInventoryUnavailableError,
  type StorageProvider,
} from "@chronelle/storage";
import { and, eq, sql } from "drizzle-orm";

export class StorageInventoryBusyError extends Error {
  constructor() {
    super("The storage inventory is busy. Try again later.");
    this.name = "StorageInventoryBusyError";
  }
}

interface StorageInventoryOptions {
  readonly clock?: (() => Date) | undefined;
  readonly maximumEntries?: number;
}

function isDocumentKey(key: string, prefix: string): boolean {
  return (
    key.startsWith(`${prefix}/`) &&
    objectIdParamsSchema.safeParse({ id: key.slice(prefix.length + 1) }).success
  );
}

/** Reports references and immediate storage entries without authorizing removal. */
export class StorageInventoryService {
  readonly #activeWorkspaces = new Set<string>();
  readonly #clock: () => Date;
  readonly #maximumEntries: number;
  readonly #authorization: AuthorizationService;

  constructor(
    private readonly database: Database,
    private readonly storage: StorageProvider,
    options: StorageInventoryOptions = {},
  ) {
    this.#authorization = new AuthorizationService(
      new DrizzleAuthorizationStore(database),
    );
    this.#clock = options.clock ?? (() => new Date());
    this.#maximumEntries = options.maximumEntries ?? 10_000;
    if (
      !Number.isSafeInteger(this.#maximumEntries) ||
      this.#maximumEntries < 1 ||
      this.#maximumEntries > 10_000
    ) {
      throw new RangeError("Inventory limits must be between 1 and 10000.");
    }
  }

  async get(principal: UserPrincipal): Promise<StorageInventoryResponse> {
    await this.#authorization.assertWorkspaceOwner(principal);
    if (
      this.#activeWorkspaces.has(principal.workspaceId) ||
      this.#activeWorkspaces.size >= 2
    ) {
      throw new StorageInventoryBusyError();
    }
    this.#activeWorkspaces.add(principal.workspaceId);
    try {
      const startedAt = this.#clock();
      const prefix = `workspaces/${principal.workspaceId}/documents`;
      if (this.storage.listObjects === undefined)
        throw new StorageInventoryUnavailableError();
      const references = await this.#loadReferences(
        principal,
        prefix,
        startedAt,
      );
      const entries = {
        canonical: 0,
        historicalOnly: 0,
        pendingUpload: 0,
        expiredUpload: 0,
        unreferenced: 0,
        unsupported: 0,
      };
      const seen = new Set<string>();
      const signal = AbortSignal.timeout(10_000);
      for await (const entry of this.storage.listObjects(prefix, signal)) {
        signal.throwIfAborted();
        if (
          !entry.storageKey.startsWith(`${prefix}/`) ||
          seen.has(entry.storageKey) ||
          seen.size >= this.#maximumEntries
        )
          throw new StorageInventoryUnavailableError();
        seen.add(entry.storageKey);
        if (entry.kind !== "file" || !isDocumentKey(entry.storageKey, prefix))
          entries.unsupported++;
        else if (references.canonical.delete(entry.storageKey))
          entries.canonical++;
        else if (references.historical.delete(entry.storageKey))
          entries.historicalOnly++;
        else if (references.uploads.get(entry.storageKey) === true)
          entries.pendingUpload++;
        else if (references.uploads.has(entry.storageKey))
          entries.expiredUpload++;
        else entries.unreferenced++;
      }
      signal.throwIfAborted();
      await this.#authorization.assertWorkspaceOwner(principal);
      return {
        workspaceId: principal.workspaceId,
        storageProvider: this.storage.providerId,
        startedAt: startedAt.toISOString(),
        completedAt: this.#clock().toISOString(),
        consistency: "observational",
        retentionPolicy: "retain-all",
        references: {
          canonical: entries.canonical + references.canonical.size,
          historicalOnly: entries.historicalOnly + references.historical.size,
          missingCanonical: references.canonical.size,
          missingHistoricalOnly: references.historical.size,
        },
        entries,
      };
    } catch (error) {
      if (error instanceof AuthorizationDeniedError) throw error;
      throw new StorageInventoryUnavailableError();
    } finally {
      this.#activeWorkspaces.delete(principal.workspaceId);
    }
  }

  async #loadReferences(
    principal: UserPrincipal,
    prefix: string,
    observedAt: Date,
  ) {
    return withReadAuthorization(
      this.database,
      async (transaction, authorization) => {
        await transaction.execute(sql`set local statement_timeout = '5s'`);
        await authorization.assertWorkspaceOwner(principal);
        const canonicalRows = await transaction
          .selectDistinct({ key: documents.storageKey })
          .from(documents)
          .where(
            and(
              eq(documents.workspaceId, principal.workspaceId),
              eq(documents.storageProvider, this.storage.providerId),
            ),
          )
          .limit(this.#maximumEntries + 1);
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
          .limit(this.#maximumEntries + 1);
        const uploadRows = await transaction
          .select({
            key: transfers.storageKey,
            recoverable: sql<boolean>`bool_or(${transfers.consumedAt} is not null or ${transfers.finalizedAt} is not null or ${transfers.expiresAt} > ${observedAt.toISOString()}::timestamptz)`,
          })
          .from(transfers)
          .where(
            and(
              eq(transfers.workspaceId, principal.workspaceId),
              eq(transfers.storageProvider, this.storage.providerId),
              eq(transfers.operation, "upload"),
            ),
          )
          .groupBy(transfers.storageKey)
          .limit(this.#maximumEntries + 1);
        if (
          [canonicalRows, revisionRows, uploadRows].some(
            (rows) => rows.length > this.#maximumEntries,
          )
        )
          throw new StorageInventoryUnavailableError();
        const canonical = new Set(canonicalRows.map((row) => row.key));
        const historical = new Set<string>();
        for (const row of revisionRows) {
          if (
            row.schemaVersion !== 1 ||
            row.objectType !== "document" ||
            !row.provider?.trim() ||
            row.key === null ||
            !isDocumentKey(row.key, prefix)
          ) {
            throw new StorageInventoryUnavailableError();
          }
          if (
            row.provider === this.storage.providerId &&
            !canonical.has(row.key)
          )
            historical.add(row.key);
        }
        const uploads = new Map(
          uploadRows.map((row) => [row.key, row.recoverable]),
        );
        const allKeys = new Set([
          ...canonical,
          ...historical,
          ...uploads.keys(),
        ]);
        if (
          allKeys.size > this.#maximumEntries ||
          [...allKeys].some((key) => !isDocumentKey(key, prefix))
        )
          throw new StorageInventoryUnavailableError();
        return { canonical, historical, uploads };
      },
    );
  }
}
