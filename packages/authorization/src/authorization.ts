import type { Role } from "@chronelle/db";

export const authorizationActions = [
  "view",
  "comment",
  "edit",
  "share",
  "delete",
  "recover",
] as const;
export type AuthorizationAction = (typeof authorizationActions)[number];

export interface UserPrincipal {
  readonly type: "user";
  readonly userId: string;
  readonly workspaceId: string;
}

export interface ResourceRef {
  readonly id: string;
  readonly workspaceId: string;
}

export interface ResourceRolesQuery {
  readonly evaluatedAt: Date;
  readonly resourceIds: readonly string[];
  readonly userId: string;
  readonly workspaceId: string;
}

export interface WorkspaceAccessQuery {
  readonly evaluatedAt: Date;
  readonly userId: string;
  readonly workspaceId: string;
}

export interface AccessibleWorkspaceQuery {
  readonly evaluatedAt: Date;
  readonly userId: string;
}

export type WorkspaceRoleQuery = Omit<WorkspaceAccessQuery, "evaluatedAt">;

export interface AuthorizationStore {
  findRecoverableResourceIds(
    query: ResourceRolesQuery,
  ): Promise<ReadonlySet<string>>;
  findResourceRoles(
    query: ResourceRolesQuery,
  ): Promise<ReadonlyMap<string, readonly Role[]>>;
  findWorkspaceRole(query: WorkspaceRoleQuery): Promise<Role | null>;
  hasWorkspaceAccess(query: WorkspaceAccessQuery): Promise<boolean>;
  listAccessibleWorkspaceIds(
    query: AccessibleWorkspaceQuery,
  ): Promise<readonly string[]>;
}

export class AuthorizationDeniedError extends Error {
  constructor() {
    super("The requested resource is unavailable.");
    this.name = "AuthorizationDeniedError";
  }
}

const roleActions: Readonly<Record<Role, readonly AuthorizationAction[]>> = {
  owner: authorizationActions,
  editor: ["view", "comment", "edit"],
  viewer: ["view"],
};

export function roleAllows(role: Role, action: AuthorizationAction): boolean {
  return roleActions[role].includes(action);
}

export class AuthorizationService {
  readonly #clock: () => Date;
  readonly #store: AuthorizationStore;

  constructor(store: AuthorizationStore, clock: () => Date = () => new Date()) {
    this.#store = store;
    this.#clock = clock;
  }

  async can(
    principal: UserPrincipal,
    action: AuthorizationAction,
    resource: ResourceRef,
  ): Promise<boolean> {
    const [allowed] = await this.canMany(principal, action, [resource]);
    return allowed ?? false;
  }

  /** Evaluate resources in input order, including duplicates and unavailable references. */
  async canMany(
    principal: UserPrincipal,
    action: AuthorizationAction,
    resources: readonly ResourceRef[],
  ): Promise<readonly boolean[]> {
    if (action !== "recover") {
      const actions = await this.allowedActionsMany(principal, resources);
      return actions.map((allowed) => allowed.includes(action));
    }
    const resourceIds = this.#resourceIds(principal, resources);
    if (resourceIds.length === 0) return resources.map(() => false);
    const recoverable = await this.#store.findRecoverableResourceIds({
      evaluatedAt: this.#clock(),
      resourceIds,
      userId: principal.userId,
      workspaceId: principal.workspaceId,
    });
    return resources.map(
      (resource) =>
        resource.workspaceId === principal.workspaceId &&
        recoverable.has(resource.id),
    );
  }

  async allowedActions(
    principal: UserPrincipal,
    resource: ResourceRef,
  ): Promise<readonly AuthorizationAction[]> {
    const [actions] = await this.allowedActionsMany(principal, [resource]);
    return actions ?? [];
  }

  /** Normal resource capabilities in input order; tombstones have no normal capabilities. */
  async allowedActionsMany(
    principal: UserPrincipal,
    resources: readonly ResourceRef[],
  ): Promise<readonly (readonly AuthorizationAction[])[]> {
    const resourceIds = this.#resourceIds(principal, resources);
    if (resourceIds.length === 0) return resources.map(() => []);
    const roles = await this.#store.findResourceRoles({
      evaluatedAt: this.#clock(),
      resourceIds,
      userId: principal.userId,
      workspaceId: principal.workspaceId,
    });
    return resources.map((resource) => {
      if (resource.workspaceId !== principal.workspaceId) return [];
      const applicable = roles.get(resource.id) ?? [];
      return authorizationActions.filter((action) =>
        applicable.some((role) => roleAllows(role, action)),
      );
    });
  }

  #resourceIds(
    principal: UserPrincipal,
    resources: readonly ResourceRef[],
  ): string[] {
    return [
      ...new Set(
        resources
          .filter((resource) => resource.workspaceId === principal.workspaceId)
          .map((resource) => resource.id),
      ),
    ];
  }

  async assertCan(
    principal: UserPrincipal,
    action: AuthorizationAction,
    resource: ResourceRef,
  ): Promise<void> {
    if (!(await this.can(principal, action, resource))) {
      throw new AuthorizationDeniedError();
    }
  }

  async canCreateInWorkspace(principal: UserPrincipal): Promise<boolean> {
    const role = await this.#store.findWorkspaceRole({
      userId: principal.userId,
      workspaceId: principal.workspaceId,
    });
    return role !== null && roleAllows(role, "edit");
  }

  async assertCanCreateInWorkspace(principal: UserPrincipal): Promise<void> {
    if (!(await this.canCreateInWorkspace(principal))) {
      throw new AuthorizationDeniedError();
    }
  }

  async assertWorkspaceOwner(principal: UserPrincipal): Promise<void> {
    const role = await this.#store.findWorkspaceRole(principal);
    if (role !== "owner") throw new AuthorizationDeniedError();
  }

  async canAccessWorkspace(
    userId: string,
    workspaceId: string,
  ): Promise<boolean> {
    return this.#store.hasWorkspaceAccess({
      evaluatedAt: this.#clock(),
      userId,
      workspaceId,
    });
  }

  async listAccessibleWorkspaceIds(userId: string): Promise<readonly string[]> {
    return this.#store.listAccessibleWorkspaceIds({
      evaluatedAt: this.#clock(),
      userId,
    });
  }
}
