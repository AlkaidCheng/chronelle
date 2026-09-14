import type { UserPrincipal } from "@chronelle/authorization";
import { CloudBaseRpcError, type CloudBaseRdbClient } from "@chronelle/db";
import {
  commandStateResponseSchema,
  type CommandStateResponse,
} from "@chronelle/schemas";

import { mapRpcError } from "./cloudbase-rpc-errors.js";
import type { CommandReadRepository } from "./command-reads.js";

/**
 * The command state through chronelle_command_state, which computes the
 * stack version and both heads with the service's edit-permission and
 * version checks in one read-only call.
 */
export class CloudBaseCommandReadRepository implements CommandReadRepository {
  readonly #client: Pick<CloudBaseRdbClient, "rpc">;

  constructor(client: Pick<CloudBaseRdbClient, "rpc">) {
    this.#client = client;
  }

  async getState(principal: UserPrincipal): Promise<CommandStateResponse> {
    let result: unknown;
    try {
      result = await this.#client.rpc("chronelle_command_state", {
        workspace_id: principal.workspaceId,
        user_id: principal.userId,
      });
    } catch (error) {
      if (error instanceof CloudBaseRpcError) throw mapRpcError(error);
      throw error;
    }
    return commandStateResponseSchema.parse(result);
  }
}
