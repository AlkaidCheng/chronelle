import {
  withReadAuthorization,
  type AuthorizationService,
  type UserPrincipal,
} from "@livtales/authorization";
import type { Database, DatabaseTransaction } from "@livtales/db";
import type { CommandStateResponse } from "@livtales/schemas";

import {
  readCommandChanges,
  readCommandStack,
  type CommandStack,
} from "./command-store.js";
import { readObjectState } from "./object-state.js";

/**
 * Read boundary for the caller's reversible command state: the stack
 * version and the undo and redo heads. Implementations report a head only
 * while the caller may still edit every object it changed, and mark it
 * unavailable when an object moved past the version the stack expects; the
 * redo head is reported only when available.
 */
export interface CommandReadRepository {
  getState(principal: UserPrincipal): Promise<CommandStateResponse>;
}

export class PostgresCommandReadRepository implements CommandReadRepository {
  readonly #database: Database;

  constructor(database: Database) {
    this.#database = database;
  }

  async getState(principal: UserPrincipal): Promise<CommandStateResponse> {
    return withReadAuthorization(
      this.#database,
      async (transaction, authorization) => {
        const stack = await readCommandStack(transaction, principal);
        const redo = await readHead(
          transaction,
          authorization,
          principal,
          stack,
          stack.redoIds.at(-1),
        );
        return {
          version: stack.version,
          undo: await readHead(
            transaction,
            authorization,
            principal,
            stack,
            stack.undoIds.at(-1),
          ),
          redo: redo?.available ? redo : null,
        };
      },
    );
  }
}

async function readHead(
  transaction: DatabaseTransaction,
  authorization: AuthorizationService,
  principal: UserPrincipal,
  stack: CommandStack,
  commandId: string | undefined,
): Promise<CommandStateResponse["undo"]> {
  if (commandId === undefined) return null;
  const changes = await readCommandChanges(transaction, principal, commandId);
  let available = true;
  for (const change of changes) {
    if (
      !(await authorization.can(principal, "edit", {
        id: change.objectId,
        workspaceId: principal.workspaceId,
      }))
    )
      return null;
    const current = await readObjectState(
      transaction,
      principal.workspaceId,
      change.objectId,
    );
    if (current.version !== stack.expectedVersions[change.objectId])
      available = false;
  }
  return { commandId, available };
}
