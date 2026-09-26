import { AuthorizationDeniedError } from "@livtales/authorization";
import {
  CloudBaseRpcError,
  type CloudBaseRdbClient,
  type CloudBaseRdbQuery,
} from "@livtales/db";
import { StorageInventoryUnavailableError } from "@livtales/storage";
import { describe, expect, it, vi } from "vitest";

import { CloudBaseStorageInventoryReadRepository } from "../src/cloudbase-storage-inventory-read-repository.js";

const workspaceId = "00000000-0000-7000-8000-000000000001";
const otherWorkspaceId = "00000000-0000-7000-8000-000000000002";
const userId = "00000000-0000-7000-8000-000000000005";
const principal = { type: "user" as const, userId, workspaceId };
const observedAt = new Date("2030-06-01T12:00:00.000Z");
const prefix = `workspaces/${workspaceId}/documents`;
const keyA = `${prefix}/00000000-0000-7000-8000-0000000000a1`;
const keyB = `${prefix}/00000000-0000-7000-8000-0000000000a2`;
const keyC = `${prefix}/00000000-0000-7000-8000-0000000000a3`;

function client(role: string | null, rows: unknown) {
  const select = (async (table: string) =>
    table === "workspace_members"
      ? role === null
        ? []
        : [{ role }]
      : []) as CloudBaseRdbClient["select"];
  return {
    capabilities: {
      transactions: false as const,
      nativeTcp: false as const,
      serverFunctions: true,
    },
    select,
    rpc: vi.fn().mockResolvedValue(rows),
  };
}

const rows = {
  canonical: [keyA],
  revisions: [
    {
      schemaVersion: 1,
      objectType: "document",
      provider: "local-filesystem",
      key: keyB,
    },
    { schemaVersion: 1, objectType: "document", provider: "s3", key: keyC },
  ],
  uploads: [{ key: keyC, recoverable: false }],
};

describe("CloudBaseStorageInventoryReadRepository", () => {
  it("checks ownership from workspace membership", async () => {
    await expect(
      new CloudBaseStorageInventoryReadRepository(
        client("owner", rows),
      ).assertWorkspaceOwner(principal),
    ).resolves.toBeUndefined();
    for (const role of ["editor", "viewer", null]) {
      await expect(
        new CloudBaseStorageInventoryReadRepository(
          client(role, rows),
        ).assertWorkspaceOwner(principal),
      ).rejects.toBeInstanceOf(AuthorizationDeniedError);
    }
  });

  it("classifies the function's rows for the provider", async () => {
    const gateway = client("owner", rows);
    const repository = new CloudBaseStorageInventoryReadRepository(gateway);
    const references = await repository.loadReferences(
      principal,
      "local-filesystem",
      observedAt,
      100,
    );
    expect(gateway.rpc).toHaveBeenCalledWith("chronelle_storage_references", {
      workspace_id: workspaceId,
      user_id: userId,
      storage_provider: "local-filesystem",
      observed_at: observedAt.toISOString(),
      row_limit: 100,
    });
    expect([...references.canonical]).toEqual([keyA]);
    expect([...references.historical]).toEqual([keyB]);
    expect([...references.uploads]).toEqual([[keyC, false]]);
  });

  it("accepts a key another workspace minted", async () => {
    const minted = `workspaces/${otherWorkspaceId}/documents/00000000-0000-7000-8000-0000000000b1`;
    const references = await new CloudBaseStorageInventoryReadRepository(
      client("owner", {
        canonical: [minted],
        revisions: [
          {
            schemaVersion: 1,
            objectType: "document",
            provider: "local-filesystem",
            key: minted,
          },
        ],
        uploads: [],
      }),
    ).loadReferences(principal, "local-filesystem", observedAt, 100);
    expect([...references.canonical]).toEqual([minted]);
    expect([...references.historical]).toEqual([]);
  });

  it("finds the keys another workspace's documents and uploads name, in batches", async () => {
    const keys = Array.from(
      { length: 80 },
      (_, index) =>
        `${prefix}/00000000-0000-7000-8000-${index.toString().padStart(12, "0")}`,
    );
    const tables: Record<string, readonly Record<string, unknown>[]> = {
      workspace_members: [{ role: "owner" }],
      documents: [
        { workspace_id: otherWorkspaceId, storage_key: keyA },
        { workspace_id: workspaceId, storage_key: keyB },
      ],
      document_transfer_authorizations: [
        { workspace_id: otherWorkspaceId, storage_key: keyC },
      ],
    };
    const gateway = client("owner", rows);
    const select = vi.fn(
      async (table: string, _query?: CloudBaseRdbQuery) => tables[table] ?? [],
    );
    const repository = new CloudBaseStorageInventoryReadRepository({
      ...gateway,
      select: select as CloudBaseRdbClient["select"],
    });

    expect(
      await repository.findReferencedElsewhere(
        principal,
        "local-filesystem",
        keys,
      ),
    ).toEqual(new Set([keyA, keyC]));
    const lookups = select.mock.calls.filter(([table]) =>
      table.startsWith("document"),
    );
    expect(lookups.map(([table]) => table)).toEqual([
      "documents",
      "document_transfer_authorizations",
      "documents",
      "document_transfer_authorizations",
    ]);
    expect(lookups[1]?.[1]).toEqual({
      columns: "workspace_id,storage_key",
      filters: [
        {
          column: "storage_provider",
          operator: "eq",
          value: "local-filesystem",
        },
        { column: "operation", operator: "eq", value: "upload" },
        { column: "storage_key", operator: "in", value: keys.slice(0, 75) },
      ],
    });
    expect(lookups[2]?.[1]?.filters?.at(-1)?.value).toEqual(keys.slice(75));
  });

  it("refuses a lookup outside the Owner's prefix or by a non-Owner", async () => {
    await expect(
      new CloudBaseStorageInventoryReadRepository(
        client("owner", rows),
      ).findReferencedElsewhere(principal, "local-filesystem", [
        keyA,
        `workspaces/${otherWorkspaceId}/documents/00000000-0000-7000-8000-0000000000b1`,
      ]),
    ).rejects.toBeInstanceOf(StorageInventoryUnavailableError);
    await expect(
      new CloudBaseStorageInventoryReadRepository(
        client("editor", rows),
      ).findReferencedElsewhere(principal, "local-filesystem", [keyA]),
    ).rejects.toBeInstanceOf(AuthorizationDeniedError);
  });

  it("refuses an oversized set and a malformed revision", async () => {
    await expect(
      new CloudBaseStorageInventoryReadRepository(
        client("owner", rows),
      ).loadReferences(principal, "local-filesystem", observedAt, 1),
    ).rejects.toBeInstanceOf(StorageInventoryUnavailableError);
    await expect(
      new CloudBaseStorageInventoryReadRepository(
        client("owner", {
          ...rows,
          revisions: [{ ...rows.revisions[0], key: "elsewhere/file" }],
        }),
      ).loadReferences(principal, "local-filesystem", observedAt, 100),
    ).rejects.toBeInstanceOf(StorageInventoryUnavailableError);
  });

  it("maps a PT403 rejection and rejects a malformed result", async () => {
    const denied = client("owner", rows);
    denied.rpc.mockRejectedValue(
      new CloudBaseRpcError(
        403,
        "DATABASE_PT403",
        "The resource is unavailable.",
      ),
    );
    await expect(
      new CloudBaseStorageInventoryReadRepository(denied).loadReferences(
        principal,
        "local-filesystem",
        observedAt,
        100,
      ),
    ).rejects.toBeInstanceOf(AuthorizationDeniedError);
    await expect(
      new CloudBaseStorageInventoryReadRepository(
        client("owner", { canonical: "not-a-list" }),
      ).loadReferences(principal, "local-filesystem", observedAt, 100),
    ).rejects.toThrow("CloudBase returned an invalid canonical key list.");
  });
});
