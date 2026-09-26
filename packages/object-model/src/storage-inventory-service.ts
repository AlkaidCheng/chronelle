import {
  AuthorizationDeniedError,
  type UserPrincipal,
} from "@livtales/authorization";
import type { Database } from "@livtales/db";
import type { StorageInventoryResponse } from "@livtales/schemas";
import {
  StorageInventoryUnavailableError,
  type StorageInventoryEntry,
  type StorageProvider,
} from "@livtales/storage";

import {
  documentKeyPrefix,
  documentPrefix,
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

/**
 * Reports a workspace's references and the stored files it accounts for,
 * without authorizing removal. A file counts where the records naming it
 * live, whichever workspace's prefix its key carries.
 */
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
      const listObjects = this.storage.listObjects?.bind(this.storage);
      if (listObjects === undefined)
        throw new StorageInventoryUnavailableError();
      const references = await this.#reads.loadReferences(
        principal,
        this.storage.providerId,
        startedAt,
        this.#maximumEntries,
      );
      const named = new Set([
        ...references.canonical,
        ...references.historical,
        ...references.uploads.keys(),
      ]);
      const listed = await this.#list(listObjects, prefix, named);
      // A file under this prefix that another workspace's records name moved
      // there with its record: that workspace's inventory counts it.
      const unnamed = listed
        .map((entry) => entry.storageKey)
        .filter((key) => !named.has(key) && documentKeyPrefix(key) === prefix);
      const elsewhere =
        unnamed.length === 0
          ? new Set<string>()
          : await this.#reads.findReferencedElsewhere(
              principal,
              this.storage.providerId,
              unnamed,
            );
      const entries = {
        canonical: 0,
        historicalOnly: 0,
        pendingUpload: 0,
        expiredUpload: 0,
        unreferenced: 0,
        unsupported: 0,
      };
      for (const entry of listed) {
        if (elsewhere.has(entry.storageKey)) continue;
        if (
          entry.kind !== "file" ||
          documentKeyPrefix(entry.storageKey) === undefined
        )
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

  /**
   * The entries the workspace accounts for: every immediate entry under its
   * own prefix, and under another workspace's prefix only the files its
   * references name there (files whose records moved in). Each listing has
   * the workspace's own bound; one abort signal bounds them all.
   */
  async #list(
    listObjects: NonNullable<StorageProvider["listObjects"]>,
    prefix: string,
    named: ReadonlySet<string>,
  ): Promise<StorageInventoryEntry[]> {
    const otherPrefixes = new Set(
      [...named].map((key) => documentKeyPrefix(key) ?? prefix),
    );
    otherPrefixes.delete(prefix);
    const listed: StorageInventoryEntry[] = [];
    const signal = AbortSignal.timeout(10_000);
    for (const listing of [prefix, ...[...otherPrefixes].sort()]) {
      const seen = new Set<string>();
      for await (const entry of listObjects(listing, signal)) {
        signal.throwIfAborted();
        if (
          !entry.storageKey.startsWith(`${listing}/`) ||
          seen.has(entry.storageKey) ||
          seen.size >= this.#maximumEntries
        )
          throw new StorageInventoryUnavailableError();
        seen.add(entry.storageKey);
        if (listing === prefix || named.has(entry.storageKey))
          listed.push(entry);
      }
    }
    signal.throwIfAborted();
    return listed;
  }
}
