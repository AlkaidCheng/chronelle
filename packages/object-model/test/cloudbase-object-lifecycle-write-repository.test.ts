import { CloudBaseRpcError } from "@livtales/db";
import { describe, expect, it, vi } from "vitest";

import { CloudBaseObjectLifecycleWriteRepository } from "../src/cloudbase-object-lifecycle-write-repository.js";
import { InvalidObjectStateError } from "../src/errors.js";

const workspaceId = "00000000-0000-7000-8000-000000000001";
const objectId = "00000000-0000-7000-8000-000000000002";
const userId = "00000000-0000-7000-8000-000000000005";
const context = {
  principal: { type: "user" as const, userId, workspaceId },
  requestId: "request-1",
};
const object = {
  id: objectId,
  workspace_id: workspaceId,
  object_type: "document",
  display_name: "Contract.pdf",
  created_by: userId,
  permission_scope_id: objectId,
  created_at: "2030-01-01T00:00:00+00:00",
  updated_at: "2030-01-03T00:00:00+00:00",
  version: 3,
  archived_at: null,
  deleted_at: null,
  custom_properties: {},
  metadata: {},
};
const document = {
  object_id: objectId,
  workspace_id: workspaceId,
  storage_provider: "local",
  storage_key: "workspace/contract.pdf",
  original_filename: "Contract.pdf",
  mime_type: "application/pdf",
  size_bytes: "123456789012",
  checksum_sha256: "a".repeat(64),
  encryption_mode: "provider",
};

describe("CloudBaseObjectLifecycleWriteRepository", () => {
  it("removes through chronelle_object_delete and decodes the deletion", async () => {
    const rpc = vi.fn().mockResolvedValue({
      id: objectId,
      version: 2,
      deletedAt: "2030-07-01T12:00:00.000Z",
    });
    const repository = new CloudBaseObjectLifecycleWriteRepository({ rpc });
    const deletedAt = new Date("2030-07-01T12:00:00.000Z");

    const deletion = await repository.remove(context, objectId, 1, deletedAt);

    expect(rpc).toHaveBeenCalledExactlyOnceWith("chronelle_object_delete", {
      workspace_id: workspaceId,
      user_id: userId,
      request_id: "request-1",
      object_id: objectId,
      expected_version: 1,
      deleted_at: "2030-07-01T12:00:00.000Z",
    });
    expect(deletion).toEqual({ id: objectId, version: 2, deletedAt });
  });

  it("recovers through chronelle_object_recover and decodes any type, documents included", async () => {
    const rpc = vi.fn().mockResolvedValue({ object, document });
    const repository = new CloudBaseObjectLifecycleWriteRepository({ rpc });

    const resource = await repository.recover(context, objectId, 2);

    expect(rpc).toHaveBeenCalledExactlyOnceWith("chronelle_object_recover", {
      workspace_id: workspaceId,
      user_id: userId,
      request_id: "request-1",
      object_id: objectId,
      expected_version: 2,
    });
    expect(resource).toMatchObject({
      id: objectId,
      objectType: "document",
      version: 3,
      deletedAt: null,
      storageKey: "workspace/contract.pdf",
      sizeBytes: 123456789012n,
      checksumSha256: "a".repeat(64),
    });
  });

  it("restores through chronelle_object_restore with the selected content", async () => {
    const rpc = vi.fn().mockResolvedValue({ object, document });
    const repository = new CloudBaseObjectLifecycleWriteRepository({ rpc });
    const sourceRevisionId = "00000000-0000-7000-8000-000000000009";

    const resource = await repository.restore(context, objectId, 2, {
      revisionId: sourceRevisionId,
      version: 1,
      content: { displayName: "Contract v1.pdf", customProperties: {} },
    });

    expect(rpc).toHaveBeenCalledExactlyOnceWith("chronelle_object_restore", {
      workspace_id: workspaceId,
      user_id: userId,
      request_id: "request-1",
      object_id: objectId,
      expected_version: 2,
      source_revision_id: sourceRevisionId,
      source_version: 1,
      content: { displayName: "Contract v1.pdf", customProperties: {} },
    });
    expect(resource).toMatchObject({ id: objectId, version: 3 });
  });

  it("rejects rows whose typed record is missing or of an unknown type", async () => {
    const missing = new CloudBaseObjectLifecycleWriteRepository({
      rpc: vi.fn().mockResolvedValue({ object }),
    });
    await expect(missing.recover(context, objectId, 2)).rejects.toThrow(
      "invalid document",
    );
    const unknown = new CloudBaseObjectLifecycleWriteRepository({
      rpc: vi.fn().mockResolvedValue({
        object: { ...object, object_type: "recipe" },
        recipe: {},
      }),
    });
    await expect(unknown.recover(context, objectId, 2)).rejects.toThrow(
      "unknown object type",
    );
  });

  it("maps a PT422 rejection to the service error with its message", async () => {
    const repository = new CloudBaseObjectLifecycleWriteRepository({
      rpc: vi
        .fn()
        .mockRejectedValue(
          new CloudBaseRpcError(
            422,
            "DATABASE_PT422",
            "The object is not in Trash.",
          ),
        ),
    });
    await expect(repository.recover(context, objectId, 1)).rejects.toThrow(
      new InvalidObjectStateError("The object is not in Trash."),
    );
  });
});
