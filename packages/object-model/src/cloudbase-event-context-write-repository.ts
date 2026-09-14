import { CloudBaseRpcError, type CloudBaseRdbClient } from "@chronelle/db";
import {
  eventContextCreateResponseSchema,
  type EventContextCreateRequest,
  type EventContextCreateResponse,
} from "@chronelle/schemas";

import { mapRpcError } from "./cloudbase-rpc-errors.js";
import { eventContextRequestHash } from "./event-context-service.js";
import type { EventContextWriteRepository } from "./object-writes.js";
import type { MutationContext } from "./types.js";

/**
 * Linked creation through chronelle_event_context_create: the child, the
 * includes relation, both audit rows, and the command record in one call.
 * The request hash is computed here with the service's own function, so both
 * backends agree on what counts as a replay.
 */
export class CloudBaseEventContextWriteRepository implements EventContextWriteRepository {
  readonly #client: Pick<CloudBaseRdbClient, "rpc">;

  constructor(client: Pick<CloudBaseRdbClient, "rpc">) {
    this.#client = client;
  }

  async create(
    context: MutationContext,
    eventId: string,
    input: EventContextCreateRequest,
  ): Promise<EventContextCreateResponse> {
    const { objectType, ...fields } = input.resource;
    const resource: Record<string, unknown> = { objectType };
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined) continue;
      resource[key] = value instanceof Date ? value.toISOString() : value;
    }
    let result: unknown;
    try {
      result = await this.#client.rpc("chronelle_event_context_create", {
        workspace_id: context.principal.workspaceId,
        user_id: context.principal.userId,
        request_id: context.requestId,
        event_id: eventId,
        command_id: input.commandId,
        request_hash: eventContextRequestHash(eventId, input),
        resource,
        relation_metadata: input.relationMetadata ?? {},
      });
    } catch (error) {
      if (error instanceof CloudBaseRpcError) throw mapRpcError(error);
      throw error;
    }
    return eventContextCreateResponseSchema.parse(result);
  }
}
