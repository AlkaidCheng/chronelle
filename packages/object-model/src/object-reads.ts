import {
  AuthorizationDeniedError,
  withReadAuthorization,
  type AuthorizationAction,
  type AuthorizationDatabase,
  type UserPrincipal,
} from "@chronelle/authorization";
import { objects } from "@chronelle/db";
import { and, eq, inArray, isNull } from "drizzle-orm";

import type { EventReadRepository } from "./event-list.js";
import type { PersonReadRepository } from "./person-list.js";
import type { TaskReadRepository } from "./task-list.js";
import { readObjectState, readObjectStates } from "./object-state.js";
import type { EventPlanningResource } from "./types.js";

/**
 * Read boundary for single canonical objects. Implementations evaluate the
 * principal's roles on the live object, deny tombstones, and return the
 * complete typed state.
 */
export interface ObjectReadRepository {
  /** The live canonical state the principal may view; anything else is denied. */
  getObject(
    principal: UserPrincipal,
    objectId: string,
  ): Promise<EventPlanningResource>;
  /** The actions the principal may take on a live object it can view. */
  getAllowedActions(
    principal: UserPrincipal,
    objectId: string,
  ): Promise<readonly AuthorizationAction[]>;
  /** Visible live states in input order; unavailable IDs are omitted. */
  listVisibleObjects(
    principal: UserPrincipal,
    objectIds: readonly string[],
  ): Promise<EventPlanningResource[]>;
}

/** Read families with a repository; absent families use the PostgreSQL path. */
export interface ObjectReadRepositories {
  readonly events?: EventReadRepository | undefined;
  readonly tasks?: TaskReadRepository | undefined;
  readonly persons?: PersonReadRepository | undefined;
  readonly objects?: ObjectReadRepository | undefined;
}

/** Authorize one action and read the live state in one snapshot; tombstones are denied. */
export async function readAuthorizedObject(
  database: AuthorizationDatabase,
  principal: UserPrincipal,
  objectId: string,
  action: AuthorizationAction,
): Promise<EventPlanningResource> {
  return withReadAuthorization(database, async (transaction, authorization) => {
    await authorization.assertCan(principal, action, {
      id: objectId,
      workspaceId: principal.workspaceId,
    });
    const resource = await readObjectState(
      transaction,
      principal.workspaceId,
      objectId,
    );
    if (resource.deletedAt !== null) throw new AuthorizationDeniedError();
    return resource;
  });
}

export class PostgresObjectReadRepository implements ObjectReadRepository {
  readonly #database: AuthorizationDatabase;

  constructor(database: AuthorizationDatabase) {
    this.#database = database;
  }

  getObject(
    principal: UserPrincipal,
    objectId: string,
  ): Promise<EventPlanningResource> {
    return readAuthorizedObject(this.#database, principal, objectId, "view");
  }

  async getAllowedActions(
    principal: UserPrincipal,
    objectId: string,
  ): Promise<readonly AuthorizationAction[]> {
    return withReadAuthorization(
      this.#database,
      async (transaction, authorization) => {
        await readAuthorizedObject(
          { database: transaction, authorization },
          principal,
          objectId,
          "view",
        );
        return authorization.allowedActions(principal, {
          id: objectId,
          workspaceId: principal.workspaceId,
        });
      },
    );
  }

  async listVisibleObjects(
    principal: UserPrincipal,
    objectIds: readonly string[],
  ): Promise<EventPlanningResource[]> {
    if (objectIds.length === 0) return [];
    return withReadAuthorization(
      this.#database,
      async (transaction, authorization) => {
        const ids = [...new Set(objectIds)];
        const visibility = await authorization.canMany(
          principal,
          "view",
          ids.map((id) => ({ id, workspaceId: principal.workspaceId })),
        );
        const visibleIds = ids.filter((_, index) => visibility[index]);
        const states = new Map<string, EventPlanningResource>();
        const batchSize = 1000;
        for (let start = 0; start < visibleIds.length; start += batchSize) {
          const rows = await readObjectStates(
            transaction,
            and(
              eq(objects.workspaceId, principal.workspaceId),
              inArray(objects.id, visibleIds.slice(start, start + batchSize)),
              isNull(objects.deletedAt),
            ),
            batchSize,
          );
          for (const row of rows) states.set(row.id, row);
        }
        return objectIds.flatMap((id) => {
          const state = states.get(id);
          return state === undefined ? [] : [state];
        });
      },
    );
  }
}
