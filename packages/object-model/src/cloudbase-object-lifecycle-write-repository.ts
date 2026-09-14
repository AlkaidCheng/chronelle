import { CloudBaseRpcError, type CloudBaseRdbClient } from "@chronelle/db";

import {
  cloudbaseDate,
  cloudbaseResourceFromRows,
  cloudbaseText,
} from "./cloudbase-read-support.js";
import { mapRpcError } from "./cloudbase-rpc-errors.js";
import type {
  ObjectLifecycleWriteRepository,
  RevisionRestoreSource,
} from "./object-writes.js";
import type {
  EventPlanningResource,
  MutationContext,
  ObjectDeletionResource,
} from "./types.js";

/**
 * Soft deletion through chronelle_object_delete, recovery through
 * chronelle_object_recover, and revision restore through
 * chronelle_object_restore. Each call is one transaction that applies the
 * service's authorization, version, state, audit, and revision rules.
 */
export class CloudBaseObjectLifecycleWriteRepository implements ObjectLifecycleWriteRepository {
  readonly #client: Pick<CloudBaseRdbClient, "rpc">;

  constructor(client: Pick<CloudBaseRdbClient, "rpc">) {
    this.#client = client;
  }

  async remove(
    context: MutationContext,
    objectId: string,
    expectedVersion: number,
    deletedAt: Date,
  ): Promise<ObjectDeletionResource> {
    const result = await this.#call("chronelle_object_delete", {
      ...principalArguments(context),
      object_id: objectId,
      expected_version: expectedVersion,
      deleted_at: deletedAt.toISOString(),
    });
    if (result === null || typeof result !== "object")
      throw new Error("CloudBase returned an invalid deletion.");
    const deletion = result as Record<string, unknown>;
    if (typeof deletion.version !== "number")
      throw new Error("CloudBase returned an invalid deletion version.");
    return {
      id: cloudbaseText(deletion.id, "deletion id"),
      version: deletion.version,
      deletedAt: cloudbaseDate(deletion.deletedAt, "deletedAt"),
    };
  }

  async recover(
    context: MutationContext,
    objectId: string,
    expectedVersion: number,
  ): Promise<EventPlanningResource> {
    return cloudbaseResourceFromRows(
      await this.#call("chronelle_object_recover", {
        ...principalArguments(context),
        object_id: objectId,
        expected_version: expectedVersion,
      }),
    );
  }

  async restore(
    context: MutationContext,
    objectId: string,
    expectedVersion: number,
    source: RevisionRestoreSource,
  ): Promise<EventPlanningResource> {
    return cloudbaseResourceFromRows(
      await this.#call("chronelle_object_restore", {
        ...principalArguments(context),
        object_id: objectId,
        expected_version: expectedVersion,
        source_revision_id: source.revisionId,
        source_version: source.version,
        content: source.content,
      }),
    );
  }

  async #call(
    functionName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    try {
      return await this.#client.rpc(functionName, args);
    } catch (error) {
      if (error instanceof CloudBaseRpcError) throw mapRpcError(error);
      throw error;
    }
  }
}

function principalArguments(context: MutationContext) {
  return {
    workspace_id: context.principal.workspaceId,
    user_id: context.principal.userId,
    request_id: context.requestId,
  };
}
