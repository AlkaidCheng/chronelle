import type { Role } from "@chronelle/db";

export const authorizationActions = [
  "view",
  "comment",
  "edit",
  "share",
  "delete",
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

export interface ResourceRoleQuery {
  readonly evaluatedAt: Date;
  readonly resource: ResourceRef;
  readonly userId: string;
}

export interface WorkspaceAccessQuery {
  readonly evaluatedAt: Date;
  readonly userId: string;
  readonly workspaceId: string;
}

export type WorkspaceRoleQuery = Omit<WorkspaceAccessQuery, "evaluatedAt">;

export interface AuthorizationStore {
  findResourceRoles(query: ResourceRoleQuery): Promise<readonly Role[] | null>;
  findWorkspaceRole(query: WorkspaceRoleQuery): Promise<Role | null>;
  hasWorkspaceAccess(query: WorkspaceAccessQuery): Promise<boolean>;
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
    if (principal.workspaceId !== resource.workspaceId) {
      return false;
    }

    const roles = await this.#store.findResourceRoles({
      evaluatedAt: this.#clock(),
      resource,
      userId: principal.userId,
    });

    return roles?.some((role) => roleAllows(role, action)) ?? false;
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
}
