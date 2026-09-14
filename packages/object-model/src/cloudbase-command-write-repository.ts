import { CloudBaseRpcError, type CloudBaseRdbClient } from "@chronelle/db";
import {
  commandReceiptSchema,
  type CommandExecuteRequest,
  type CommandReceipt,
  type CommandTransitionRequest,
} from "@chronelle/schemas";

import { mapRpcError } from "./cloudbase-rpc-errors.js";
import { hashCommand } from "./command-hash.js";
import type { CommandWriteRepository } from "./object-writes.js";
import type { MutationContext } from "./types.js";

/**
 * Reversible commands through chronelle_command_execute and
 * chronelle_command_transition: the edits, the command record, the stack
 * advance, and the receipt in one call. The request hash is computed here
 * with the service's own function, so both backends agree on what counts as
 * a replay.
 */
export class CloudBaseCommandWriteRepository implements CommandWriteRepository {
  readonly #client: Pick<CloudBaseRdbClient, "rpc">;

  constructor(client: Pick<CloudBaseRdbClient, "rpc">) {
    this.#client = client;
  }

  async execute(
    context: MutationContext,
    input: CommandExecuteRequest,
  ): Promise<CommandReceipt> {
    return this.#call("chronelle_command_execute", {
      ...principalArguments(context),
      operation_id: input.operationId,
      expected_stack_version: input.expectedStackVersion,
      edits: input.edits.map((edit) => ({
        objectType: edit.objectType,
        objectId: edit.objectId,
        patch: encodePatch(edit.patch),
      })),
      request_hash: hashCommand({ direction: "execute", input }),
    });
  }

  async transition(
    context: MutationContext,
    input: CommandTransitionRequest,
    direction: "undo" | "redo",
  ): Promise<CommandReceipt> {
    return this.#call("chronelle_command_transition", {
      ...principalArguments(context),
      operation_id: input.operationId,
      command_id: input.commandId,
      expected_stack_version: input.expectedStackVersion,
      direction,
      request_hash: hashCommand({ direction, input }),
    });
  }

  async #call(
    functionName: string,
    args: Record<string, unknown>,
  ): Promise<CommandReceipt> {
    let result: unknown;
    try {
      result = await this.#client.rpc(functionName, args);
    } catch (error) {
      if (error instanceof CloudBaseRpcError) throw mapRpcError(error);
      throw error;
    }
    return commandReceiptSchema.parse(result);
  }
}

function principalArguments(context: MutationContext) {
  return {
    workspace_id: context.principal.workspaceId,
    user_id: context.principal.userId,
    request_id: context.requestId,
  };
}

/** JSON for the function: instants as ISO strings, absent fields omitted, null kept. */
function encodePatch(patch: object): Record<string, unknown> {
  const encoded: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    encoded[key] = value instanceof Date ? value.toISOString() : value;
  }
  return encoded;
}
