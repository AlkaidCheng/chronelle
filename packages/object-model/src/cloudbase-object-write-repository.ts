import { CloudBaseRpcError, type CloudBaseRdbClient } from "@chronelle/db";

import { mapRpcError } from "./cloudbase-rpc-errors.js";
import { InvalidObjectStateError } from "./errors.js";
import type { ObjectWriteRepository } from "./object-writes.js";
import type { MutationContext } from "./types.js";

/** What a family's functions are called and how their returned rows decode. */
export interface CloudBaseWriteFamily<Resource> {
  readonly objectType: "event" | "task" | "expense" | "reminder" | "person";
  readonly decode: (rows: unknown) => Resource;
}

interface WriteFields {
  readonly expectedVersion?: number;
}

/**
 * One gateway rpc call per write. The chronelle_<type>_create and
 * chronelle_<type>_update functions run as one transaction and apply the
 * same authorization, version, audit, and revision rules as the PostgreSQL
 * service; this adapter only encodes the input and maps a function's
 * SQLSTATE to the service's error classes.
 */
export class CloudBaseObjectWriteRepository<
  CreateInput extends object,
  UpdateInput extends WriteFields,
  Resource,
> implements ObjectWriteRepository<CreateInput, UpdateInput, Resource> {
  readonly #client: Pick<CloudBaseRdbClient, "rpc">;
  readonly #family: CloudBaseWriteFamily<Resource>;

  constructor(
    client: Pick<CloudBaseRdbClient, "rpc">,
    family: CloudBaseWriteFamily<Resource>,
  ) {
    this.#client = client;
    this.#family = family;
  }

  async create(
    context: MutationContext,
    input: CreateInput,
  ): Promise<Resource> {
    const rows = await this.#call(
      `chronelle_${this.#family.objectType}_create`,
      {
        workspace_id: context.principal.workspaceId,
        user_id: context.principal.userId,
        request_id: context.requestId,
        input: encodeFields(input),
      },
    );
    return this.#family.decode(rows);
  }

  async update(
    context: MutationContext,
    objectId: string,
    input: UpdateInput,
  ): Promise<Resource> {
    const { expectedVersion, ...changes } = input;
    const rows = await this.#call(
      `chronelle_${this.#family.objectType}_update`,
      {
        workspace_id: context.principal.workspaceId,
        user_id: context.principal.userId,
        request_id: context.requestId,
        object_id: objectId,
        expected_version: expectedVersion,
        changes: encodeFields(changes),
        command: context.command ?? null,
      },
    );
    return this.#family.decode(rows);
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
function encodeFields(fields: object): Record<string, unknown> {
  const encoded: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    encoded[key] = value instanceof Date ? encodeInstant(key, value) : value;
  }
  return encoded;
}

/** An invalid Date fails the way the service's assertValidDate() fails. */
function encodeInstant(field: string, value: Date): string {
  if (!Number.isFinite(value.getTime()))
    throw new InvalidObjectStateError(`${field} must be a valid date.`);
  return value.toISOString();
}

/** Reads `{ object, <typed> }` rows as returned by chronelle_<type>_rows. */
export function decodeRows<ObjectRow, TypedRow>(
  rows: unknown,
  typedKey: string,
): { object: ObjectRow; typed: TypedRow } {
  if (rows === null || typeof rows !== "object")
    throw new Error(`CloudBase returned an invalid ${typedKey}.`);
  const record = rows as Record<string, unknown>;
  const object = record.object;
  const typed = record[typedKey];
  if (object === undefined || typed === undefined)
    throw new Error(`CloudBase returned an invalid ${typedKey}.`);
  return { object: object as ObjectRow, typed: typed as TypedRow };
}
