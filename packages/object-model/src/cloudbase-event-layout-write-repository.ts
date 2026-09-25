import { CloudBaseRpcError, type CloudBaseRdbClient } from "@livtales/db";
import {
  eventLayoutResponseSchema,
  type EventLayoutResponse,
  type EventPage,
} from "@livtales/schemas";

import { mapRpcError } from "./cloudbase-rpc-errors.js";
import type { EventLayoutWriteRepository } from "./object-writes.js";
import type { MutationContext } from "./types.js";

/**
 * Layout changes through chronelle_event_layout_update and
 * chronelle_event_layout_restore. Each call is one transaction that applies
 * the service's authorization, version, and audit rules; the response is
 * the layout schema the service returns.
 */
export class CloudBaseEventLayoutWriteRepository implements EventLayoutWriteRepository {
  readonly #client: Pick<CloudBaseRdbClient, "rpc">;

  constructor(client: Pick<CloudBaseRdbClient, "rpc">) {
    this.#client = client;
  }

  async update(
    context: MutationContext,
    eventId: string,
    expectedVersion: number,
    pages: readonly EventPage[],
  ): Promise<EventLayoutResponse> {
    return this.#call("chronelle_event_layout_update", {
      ...principalArguments(context),
      event_id: eventId,
      expected_version: expectedVersion,
      pages,
    });
  }

  async restore(
    context: MutationContext,
    eventId: string,
    expectedVersion: number,
    targetVersion: number,
  ): Promise<EventLayoutResponse> {
    return this.#call("chronelle_event_layout_restore", {
      ...principalArguments(context),
      event_id: eventId,
      expected_version: expectedVersion,
      target_version: targetVersion,
    });
  }

  async #call(
    functionName: string,
    args: Record<string, unknown>,
  ): Promise<EventLayoutResponse> {
    let result: unknown;
    try {
      result = await this.#client.rpc(functionName, args);
    } catch (error) {
      if (error instanceof CloudBaseRpcError) throw mapRpcError(error);
      throw error;
    }
    return eventLayoutResponseSchema.parse(result);
  }
}

function principalArguments(context: MutationContext) {
  return {
    workspace_id: context.principal.workspaceId,
    user_id: context.principal.userId,
    request_id: context.requestId,
  };
}
