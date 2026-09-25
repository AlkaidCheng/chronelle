import {
  AuthorizationDeniedError,
  type UserPrincipal,
} from "@livtales/authorization";
import { CloudBaseRpcError, type CloudBaseRdbClient } from "@livtales/db";

import {
  cloudbaseInteger,
  readCloudBasePrincipalAccess,
} from "./cloudbase-object-read-support.js";
import {
  cloudbaseNullableText,
  cloudbaseText,
} from "./cloudbase-read-support.js";
import { mapRpcError } from "./cloudbase-rpc-errors.js";
import {
  classifyReferences,
  documentPrefix,
  type StorageInventoryReadRepository,
  type StorageReferenceRows,
  type StorageReferences,
} from "./storage-inventory-reads.js";

function cloudbaseList(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value))
    throw new Error(`CloudBase returned an invalid ${label}.`);
  return value;
}

function cloudbaseRecord(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error(`CloudBase returned an invalid ${label}.`);
  return value as Record<string, unknown>;
}

/** Reads the rows chronelle_storage_references returns. */
function cloudbaseReferenceRows(result: unknown): StorageReferenceRows {
  const record = cloudbaseRecord(result, "storage reference set");
  return {
    canonical: cloudbaseList(record.canonical, "canonical key list").map(
      (key) => cloudbaseText(key, "canonical key"),
    ),
    revisions: cloudbaseList(record.revisions, "revision reference list").map(
      (entry) => {
        const row = cloudbaseRecord(entry, "revision reference");
        return {
          schemaVersion: cloudbaseInteger(row.schemaVersion, "schema version"),
          objectType: cloudbaseNullableText(row.objectType, "object type"),
          provider: cloudbaseNullableText(row.provider, "storage provider"),
          key: cloudbaseNullableText(row.key, "storage key"),
        };
      },
    ),
    uploads: cloudbaseList(record.uploads, "upload reference list").map(
      (entry) => {
        const row = cloudbaseRecord(entry, "upload reference");
        if (typeof row.recoverable !== "boolean")
          throw new Error("CloudBase returned an invalid upload state.");
        return {
          key: cloudbaseText(row.key, "upload key"),
          recoverable: row.recoverable,
        };
      },
    ),
  };
}

/**
 * The storage inventory's reads through the gateway: the Owner check from
 * workspace membership, and the referenced keys from
 * chronelle_storage_references, classified by the same rules as the
 * PostgreSQL read.
 */
export class CloudBaseStorageInventoryReadRepository implements StorageInventoryReadRepository {
  readonly #client: Pick<CloudBaseRdbClient, "capabilities" | "select" | "rpc">;
  readonly #clock: () => Date;

  constructor(
    client: Pick<CloudBaseRdbClient, "capabilities" | "select" | "rpc">,
    clock: () => Date = () => new Date(),
  ) {
    this.#client = client;
    this.#clock = clock;
  }

  async assertWorkspaceOwner(principal: UserPrincipal): Promise<void> {
    const access = await readCloudBasePrincipalAccess(
      this.#client,
      principal,
      this.#clock,
    );
    if (access.workspaceRole !== "owner") throw new AuthorizationDeniedError();
  }

  async loadReferences(
    principal: UserPrincipal,
    providerId: string,
    observedAt: Date,
    maximumEntries: number,
  ): Promise<StorageReferences> {
    let result: unknown;
    try {
      result = await this.#client.rpc("chronelle_storage_references", {
        workspace_id: principal.workspaceId,
        user_id: principal.userId,
        storage_provider: providerId,
        observed_at: observedAt.toISOString(),
        row_limit: maximumEntries,
      });
    } catch (error) {
      if (error instanceof CloudBaseRpcError) throw mapRpcError(error);
      throw error;
    }
    return classifyReferences(
      cloudbaseReferenceRows(result),
      providerId,
      documentPrefix(principal.workspaceId),
      maximumEntries,
    );
  }
}
