import { CloudBaseRpcError } from "@livtales/db";
import { describe, expect, it, vi } from "vitest";

import { CloudBaseRelationWriteRepository } from "../src/cloudbase-relation-write-repository.js";
import { InvalidRelationError, RelationConflictError } from "../src/errors.js";

const workspaceId = "00000000-0000-7000-8000-000000000001";
const sourceId = "00000000-0000-7000-8000-000000000002";
const targetId = "00000000-0000-7000-8000-000000000003";
const relationId = "00000000-0000-7000-8000-000000000004";
const userId = "00000000-0000-7000-8000-000000000005";
const context = {
  principal: { type: "user" as const, userId, workspaceId },
  requestId: "request-1",
};
const row = {
  id: relationId,
  workspace_id: workspaceId,
  source_object_id: sourceId,
  relation_type: "includes",
  target_object_id: targetId,
  metadata: { order: 1 },
  created_by: userId,
  created_at: "2030-01-01T00:00:00+00:00",
  deleted_at: null,
  version: 1,
};

describe("CloudBaseRelationWriteRepository", () => {
  it("creates, removes, and recovers through the two functions", async () => {
    const rpc = vi.fn().mockResolvedValue(row);
    const repository = new CloudBaseRelationWriteRepository({ rpc });
    const deletedAt = new Date("2030-06-01T12:00:00.000Z");

    const created = await repository.create(context, {
      sourceObjectId: sourceId,
      relationType: "includes",
      targetObjectId: targetId,
      metadata: { order: 1 },
    });
    await repository.remove(context, relationId, 1, deletedAt);
    await repository.recover(context, relationId, 2);

    const principal = {
      workspace_id: workspaceId,
      user_id: userId,
      request_id: "request-1",
    };
    expect(rpc).toHaveBeenNthCalledWith(1, "chronelle_relation_create", {
      ...principal,
      source_object_id: sourceId,
      relation_type: "includes",
      target_object_id: targetId,
      metadata: { order: 1 },
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "chronelle_relation_lifecycle", {
      ...principal,
      relation_id: relationId,
      expected_version: 1,
      deleted_at: "2030-06-01T12:00:00.000Z",
    });
    expect(rpc).toHaveBeenNthCalledWith(3, "chronelle_relation_lifecycle", {
      ...principal,
      relation_id: relationId,
      expected_version: 2,
      deleted_at: null,
    });
    expect(created).toEqual({
      id: relationId,
      workspaceId,
      sourceObjectId: sourceId,
      relationType: "includes",
      targetObjectId: targetId,
      metadata: { order: 1 },
      createdBy: userId,
      createdAt: new Date("2030-01-01T00:00:00.000Z"),
      deletedAt: null,
      version: 1,
    });
  });

  it("sends an empty metadata object when none is given", async () => {
    const rpc = vi.fn().mockResolvedValue(row);
    await new CloudBaseRelationWriteRepository({ rpc }).create(context, {
      sourceObjectId: sourceId,
      relationType: "includes",
      targetObjectId: targetId,
    });
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({ metadata: {} });
  });

  it.each([
    [
      "DATABASE_PT400",
      "The relationship is already in the requested state.",
      InvalidRelationError,
    ],
    [
      "DATABASE_PT409",
      "The active relationship already exists.",
      RelationConflictError,
    ],
  ])("maps %s to the service error", async (code, message, expected) => {
    const repository = new CloudBaseRelationWriteRepository({
      rpc: vi.fn().mockRejectedValue(new CloudBaseRpcError(400, code, message)),
    });
    const error = await repository
      .recover(context, relationId, 1)
      .then(() => {
        throw new Error("expected a rejection");
      })
      .catch((failure: Error) => failure);
    expect(error).toBeInstanceOf(expected);
    expect(error.message).toBe(message);
  });

  it("rejects a row with an unknown relation type", async () => {
    const repository = new CloudBaseRelationWriteRepository({
      rpc: vi.fn().mockResolvedValue({ ...row, relation_type: "owns" }),
    });
    await expect(repository.recover(context, relationId, 1)).rejects.toThrow(
      "invalid relation type",
    );
  });
});
