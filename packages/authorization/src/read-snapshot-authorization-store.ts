import type { Role } from "@chronelle/db";

import type {
  AccessibleWorkspaceQuery,
  AuthorizationStore,
  GrantNarrowing,
  GrantNarrowingQuery,
  ResourceAccessQuery,
  ResourceRolesQuery,
  WorkspaceAccessQuery,
  WorkspaceRoleQuery,
} from "./authorization.js";

/**
 * Reuses role rows only inside one read-only database snapshot. Missing rows
 * are cached too, and failed reads are evicted so a later check can retry.
 */
export class ReadSnapshotAuthorizationStore implements AuthorizationStore {
  readonly #store: AuthorizationStore;
  readonly #roles = new Map<string, Promise<readonly Role[]>>();

  constructor(store: AuthorizationStore) {
    this.#store = store;
  }

  resourcePredicate(query: ResourceAccessQuery) {
    return this.#store.resourcePredicate(query);
  }

  memberPredicate(query: WorkspaceAccessQuery) {
    return this.#store.memberPredicate(query);
  }

  sharedPredicate(query: AccessibleWorkspaceQuery) {
    return this.#store.sharedPredicate(query);
  }

  findGrantNarrowing(
    query: GrantNarrowingQuery,
  ): Promise<GrantNarrowing | null> {
    return this.#store.findGrantNarrowing(query);
  }

  findRecoverableResourceIds(
    query: ResourceRolesQuery,
  ): Promise<ReadonlySet<string>> {
    return this.#store.findRecoverableResourceIds(query);
  }

  async findResourceRoles(
    query: ResourceRolesQuery,
  ): Promise<ReadonlyMap<string, readonly Role[]>> {
    const keys = query.resourceIds.map((resourceId) => ({
      resourceId,
      key: this.#key(query, resourceId),
    }));
    const missing = [
      ...new Set(
        keys
          .filter(({ key }) => !this.#roles.has(key))
          .map(({ resourceId }) => resourceId),
      ),
    ];
    if (missing.length > 0) {
      const read = this.#store.findResourceRoles({
        ...query,
        resourceIds: missing,
      });
      for (const resourceId of missing) {
        const key = this.#key(query, resourceId);
        const roles = read.then((found) => found.get(resourceId) ?? []);
        this.#roles.set(key, roles);
        void roles.catch(() => {
          if (this.#roles.get(key) === roles) this.#roles.delete(key);
        });
      }
    }
    const resolved = await Promise.all(
      keys.map(async ({ key, resourceId }) => ({
        resourceId,
        roles: await this.#roles.get(key),
      })),
    );
    return new Map(
      resolved.flatMap(({ resourceId, roles }) =>
        roles === undefined || roles.length === 0
          ? []
          : [[resourceId, roles] as const],
      ),
    );
  }

  findWorkspaceRole(query: WorkspaceRoleQuery): Promise<Role | null> {
    return this.#store.findWorkspaceRole(query);
  }

  hasWorkspaceAccess(query: WorkspaceAccessQuery): Promise<boolean> {
    return this.#store.hasWorkspaceAccess(query);
  }

  listAccessibleWorkspaceIds(
    query: AccessibleWorkspaceQuery,
  ): Promise<readonly string[]> {
    return this.#store.listAccessibleWorkspaceIds(query);
  }

  #key(query: ResourceRolesQuery, resourceId: string): string {
    return JSON.stringify([
      query.evaluatedAt.getTime(),
      query.userId,
      query.workspaceId,
      resourceId,
    ]);
  }
}
