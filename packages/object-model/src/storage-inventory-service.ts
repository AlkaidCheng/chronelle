import {
  AuthorizationDeniedError,
  type UserPrincipal,
} from "@livtales/authorization";
import type { Database } from "@livtales/db";
import type { StorageInventoryResponse } from "@livtales/schemas";
import {
  StorageInventoryUnavailableError,
  type StorageProvider,
} from "@livtales/storage";

import {
  documentPrefix,
  isDocumentKey,
  PostgresStorageInventoryReadRepository,
  type StorageInventoryReadRepository,
} from "./storage-inventory-reads.js";

export class StorageInventoryBusyError extends Error {
  constructor() {
    super("The storage inventory is busy. Try again later.");
    this.name = "StorageInventoryBusyError";
  }
}

interface StorageInventoryOptions {
  readonly clock?: (() => Date) | undefined;
  readonly maximumEntries?: number;
  /** The Owner check and the referenced keys; PostgreSQL when absent. */
  readonly reads?: StorageInventoryReadRepository | undefined;
}

/** Reports references and immediate storage entries without authorizing removal. */
export class StorageInventoryService {
  readonly #activeWorkspaces = new Set<string>();
  readonly #clock: () => Date;
  readonly #maximumEntries: number;
  readonly #reads: StorageInventoryReadRepository;

  constructor(
    database: Database,
    private readonly storage: StorageProvider,
    options: StorageInventoryOptions = {},
  ) {
    this.#reads =
      options.reads ?? new PostgresStorageInventoryReadRepository(database);
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
    await this.#reads.assertWorkspaceOwner(principal);
    if (
      this.#activeWorkspaces.has(principal.workspaceId) ||
      this.#activeWorkspaces.size >= 2
    ) {
      throw new StorageInventoryBusyError();
    }
    this.#activeWorkspaces.add(principal.workspaceId);
    try {
      const startedAt = this.#clock();
      const prefix = documentPrefix(principal.workspaceId);
      if (this.storage.listObjects === undefined)
        throw new StorageInventoryUnavailableError();
      const references = await this.#reads.loadReferences(
        principal,
        this.storage.providerId,
        startedAt,
        this.#maximumEntries,
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
      await this.#reads.assertWorkspaceOwner(principal);
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
}
