import {
  AuthorizationDeniedError,
  withReadAuthorization,
  type AuthorizationAction,
  type GrantNarrowing,
  type AuthorizationDatabase,
  type UserPrincipal,
} from "@livtales/authorization";
import {
  type DatabaseTransaction,
  objects,
  resourceGrants,
  type Role,
  users,
  workspaceMembers,
} from "@livtales/db";
import { and, eq, gt, inArray, isNull, or } from "drizzle-orm";

import type { EventReadRepository } from "./event-list.js";
import type { PersonReadRepository } from "./person-list.js";
import type { TaskReadRepository } from "./task-list.js";
import { readObjectState, readObjectStates } from "./object-state.js";
import type { EventPlanningResource } from "./types.js";

/** An account named beside the access it granted or holds. */
export interface AccountSummary {
  readonly id: string;
  readonly displayName: string;
}

/**
 * Where the principal's access to a live object comes from: membership of
 * the workspace, a grant on the object, or a grant on the Event whose
 * scope the object inherits. A direct grant names itself before an
 * inherited one; membership names itself before either.
 */
export type AccessSource =
  | { readonly kind: "own" }
  | {
      readonly kind: "direct";
      readonly grantedBy: AccountSummary;
      readonly role: Role;
    }
  | {
      readonly kind: "inherited";
      readonly through: AccountSummary;
      readonly grantedBy: AccountSummary;
      readonly role: Role;
    };

/** What a principal may do to an object, and where that access comes from. */
export interface ObjectAccess {
  readonly actions: readonly AuthorizationAction[];
  readonly source: AccessSource;
  /** For an Event: what of it narrowed grants open; null for all of it. */
  readonly narrowing: GrantNarrowing | null;
}

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
  /** The actions and their source for a live object the principal can view, in one snapshot. */
  getAccess(principal: UserPrincipal, objectId: string): Promise<ObjectAccess>;
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

  async getAccess(
    principal: UserPrincipal,
    objectId: string,
  ): Promise<ObjectAccess> {
    return withReadAuthorization(
      this.#database,
      async (transaction, authorization) => {
        const object = await readAuthorizedObject(
          { database: transaction, authorization },
          principal,
          objectId,
          "view",
        );
        const resource = { id: objectId, workspaceId: principal.workspaceId };
        const [actions, narrowing] = await Promise.all([
          authorization.allowedActions(principal, resource),
          authorization.narrowing(principal, resource),
        ]);
        return {
          actions,
          source: await readAccessSource(transaction, principal, object),
          narrowing,
        };
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

/** Membership, else the grant on the object, else the grant on its scope. */
async function readAccessSource(
  transaction: DatabaseTransaction,
  principal: UserPrincipal,
  object: EventPlanningResource,
): Promise<AccessSource> {
  const [membership] = await transaction
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, principal.workspaceId),
        eq(workspaceMembers.userId, principal.userId),
      ),
    )
    .limit(1);
  if (membership !== undefined) return { kind: "own" };
  const grants = await transaction
    .select({
      resourceId: resourceGrants.resourceId,
      role: resourceGrants.role,
      grantedBy: { id: users.id, displayName: users.displayName },
    })
    .from(resourceGrants)
    .innerJoin(users, eq(users.id, resourceGrants.grantedBy))
    .where(
      and(
        eq(resourceGrants.workspaceId, principal.workspaceId),
        eq(resourceGrants.principalType, "user"),
        eq(resourceGrants.principalId, principal.userId),
        inArray(resourceGrants.resourceId, [
          object.id,
          object.permissionScopeId,
        ]),
        or(
          isNull(resourceGrants.expiresAt),
          gt(resourceGrants.expiresAt, new Date()),
        ),
      ),
    );
  const direct = grants.find((grant) => grant.resourceId === object.id);
  if (direct !== undefined)
    return { kind: "direct", grantedBy: direct.grantedBy, role: direct.role };
  const inherited = grants.find(
    (grant) => grant.resourceId === object.permissionScopeId,
  );
  const [scope] =
    inherited === undefined
      ? []
      : await transaction
          .select({ id: objects.id, displayName: objects.displayName })
          .from(objects)
          .where(
            and(
              eq(objects.workspaceId, principal.workspaceId),
              eq(objects.id, object.permissionScopeId),
              isNull(objects.deletedAt),
            ),
          )
          .limit(1);
  if (inherited === undefined || scope === undefined)
    throw new AuthorizationDeniedError();
  return {
    kind: "inherited",
    through: scope,
    grantedBy: inherited.grantedBy,
    role: inherited.role,
  };
}
