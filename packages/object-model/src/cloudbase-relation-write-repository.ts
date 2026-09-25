import { CloudBaseRpcError, type CloudBaseRdbClient } from "@livtales/db";

import {
  type CloudBaseRelationWriteRow,
  cloudbaseRelationResource,
} from "./cloudbase-read-support.js";
import { mapRpcError } from "./cloudbase-rpc-errors.js";
import type { RelationWriteRepository } from "./object-writes.js";
import type {
  CreateObjectRelationInput,
  MutationContext,
  ObjectRelationResource,
} from "./types.js";

/**
 * Relation writes through chronelle_relation_create and
 * chronelle_relation_lifecycle. Each call is one transaction that applies
 * the service's authorization, compatibility, version, and audit rules.
 */
export class CloudBaseRelationWriteRepository implements RelationWriteRepository {
  readonly #client: Pick<CloudBaseRdbClient, "rpc">;

  constructor(client: Pick<CloudBaseRdbClient, "rpc">) {
    this.#client = client;
  }

  async create(
    context: MutationContext,
    input: CreateObjectRelationInput,
  ): Promise<ObjectRelationResource> {
    return this.#call("chronelle_relation_create", {
      ...principalArguments(context),
      source_object_id: input.sourceObjectId,
      relation_type: input.relationType,
      target_object_id: input.targetObjectId,
      metadata: input.metadata ?? {},
    });
  }

  async remove(
    context: MutationContext,
    relationId: string,
    expectedVersion: number,
    deletedAt: Date,
  ): Promise<ObjectRelationResource> {
    return this.#call("chronelle_relation_lifecycle", {
      ...principalArguments(context),
      relation_id: relationId,
      expected_version: expectedVersion,
      deleted_at: deletedAt.toISOString(),
    });
  }

  async recover(
    context: MutationContext,
    relationId: string,
    expectedVersion: number,
  ): Promise<ObjectRelationResource> {
    return this.#call("chronelle_relation_lifecycle", {
      ...principalArguments(context),
      relation_id: relationId,
      expected_version: expectedVersion,
      deleted_at: null,
    });
  }

  async #call(
    functionName: string,
    args: Record<string, unknown>,
  ): Promise<ObjectRelationResource> {
    let row: unknown;
    try {
      row = await this.#client.rpc(functionName, args);
    } catch (error) {
      if (error instanceof CloudBaseRpcError) throw mapRpcError(error);
      throw error;
    }
    if (row === null || typeof row !== "object")
      throw new Error("CloudBase returned an invalid relation.");
    return cloudbaseRelationResource(row as CloudBaseRelationWriteRow);
  }
}

function principalArguments(context: MutationContext) {
  return {
    workspace_id: context.principal.workspaceId,
    user_id: context.principal.userId,
    request_id: context.requestId,
  };
}
