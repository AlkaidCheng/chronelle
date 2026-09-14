import { AuthorizationDeniedError } from "@chronelle/authorization";
import { CloudBaseRpcError, type CloudBaseRdbClient } from "@chronelle/db";

import {
  type CloudBaseEventRow,
  type CloudBaseObjectRow,
  cloudbaseEventResource,
} from "./cloudbase-read-support.js";
import { InvalidObjectStateError, ObjectConflictError } from "./errors.js";
import type { EventWriteRepository } from "./event-writes.js";
import type {
  CreateEventInput,
  EventResource,
  MutationContext,
  UpdateEventInput,
} from "./types.js";

/**
 * Event writes as one gateway rpc call each. The chronelle_event_create and
 * chronelle_event_update functions (migration 0012) run as one transaction
 * and apply the same authorization, version, audit, and revision rules as
 * the PostgreSQL service; this adapter only encodes the input and maps the
 * function's SQLSTATE to the service's error classes.
 */
export class CloudBaseEventWriteRepository implements EventWriteRepository {
  readonly #client: Pick<CloudBaseRdbClient, "rpc">;

  constructor(client: Pick<CloudBaseRdbClient, "rpc">) {
    this.#client = client;
  }

  async createEvent(
    context: MutationContext,
    input: CreateEventInput,
  ): Promise<EventResource> {
    const rows = await this.#call("chronelle_event_create", {
      workspace_id: context.principal.workspaceId,
      user_id: context.principal.userId,
      request_id: context.requestId,
      input: encodeEventFields(input),
    });
    return decodeEventRows(rows);
  }

  async updateEvent(
    context: MutationContext,
    objectId: string,
    input: UpdateEventInput,
  ): Promise<EventResource> {
    const { expectedVersion, ...changes } = input;
    const rows = await this.#call("chronelle_event_update", {
      workspace_id: context.principal.workspaceId,
      user_id: context.principal.userId,
      request_id: context.requestId,
      object_id: objectId,
      expected_version: expectedVersion,
      changes: encodeEventFields(changes),
      command: context.command ?? null,
    });
    return decodeEventRows(rows);
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

/** JSON for the function: instants as ISO strings, absent fields omitted, null kept. */
function encodeEventFields(
  fields: CreateEventInput | Omit<UpdateEventInput, "expectedVersion">,
): Record<string, unknown> {
  const encoded: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    encoded[key] = value instanceof Date ? value.toISOString() : value;
  }
  return encoded;
}

function decodeEventRows(rows: unknown): EventResource {
  if (rows === null || typeof rows !== "object")
    throw new Error("CloudBase returned an invalid event.");
  const { object, event } = rows as {
    object?: CloudBaseObjectRow;
    event?: CloudBaseEventRow;
  };
  if (object === undefined || event === undefined)
    throw new Error("CloudBase returned an invalid event.");
  return cloudbaseEventResource(object, event);
}

/** The gateway prefixes SQLSTATEs (DATABASE_PT409); only the suffix carries meaning. */
function mapRpcError(error: CloudBaseRpcError): Error {
  if (error.code.endsWith("PT403")) return new AuthorizationDeniedError();
  if (error.code.endsWith("PT409")) return new ObjectConflictError();
  if (error.code.endsWith("PT422"))
    return new InvalidObjectStateError(error.message);
  return error;
}
