import { AuthorizationDeniedError } from "@chronelle/authorization";
import { CloudBaseRpcError, type CloudBaseRdbClient } from "@chronelle/db";
import { StorageInventoryUnavailableError } from "@chronelle/storage";
import { describe, expect, it, vi } from "vitest";

import { CloudBaseStorageInventoryReadRepository } from "../src/cloudbase-storage-inventory-read-repository.js";

const workspaceId = "00000000-0000-7000-8000-000000000001";
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
