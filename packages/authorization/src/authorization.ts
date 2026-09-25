import type { GrantScope, Role } from "@livtales/db";
import type { SQL } from "drizzle-orm";

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

/** A view of an Event a grant can be narrowed to. */
export type ShareView = Exclude<GrantScope, "all">;

/** The narrowing of one grant: a view of the Event, and a section of it when narrower. */
export interface ShareScope {
  readonly view: ShareView;
  readonly sectionId: string | null;
}

export const shareViews: readonly ShareView[] = [
  "todos",
  "calendar",
  "itinerary",
  "expenses",
  "reminders",
  "notes",
];

/** The object types a view shows, which a grant narrowed to it admits. */
export const viewObjectTypes: Readonly<Record<ShareView, readonly string[]>> = {
  todos: ["task"],
  calendar: ["event"],
  itinerary: ["event"],
  expenses: ["expense"],
  reminders: ["reminder"],
  notes: ["note"],
};

/**
 * What of an Event a principal sees through narrowed grants alone: the
 * views shared whole, and the sections shared on their own. Absent when
 * the principal is a member or holds a whole grant, and so sees everything.
 */
export interface GrantNarrowing {
  readonly views: readonly ShareView[];
  readonly sections: readonly {
    readonly id: string;
    readonly view: ShareView;
  }[];
}

export interface GrantNarrowingQuery extends WorkspaceAccessQuery {
  readonly resourceId: string;
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

export interface ResourceAccessQuery extends WorkspaceAccessQuery {
  readonly action: AuthorizationAction;
}

export interface AccessibleWorkspaceQuery {
  readonly evaluatedAt: Date;
  readonly userId: string;
}

export type WorkspaceRoleQuery = Omit<WorkspaceAccessQuery, "evaluatedAt">;

export interface AuthorizationStore {
  resourcePredicate(query: ResourceAccessQuery): SQL;
  /** Live objects of the query's workspace the user reaches as its member. */
  memberPredicate(query: WorkspaceAccessQuery): SQL;
  /**
   * Live objects, in any workspace the user is not a member of, that an
   * active grant on the object itself lets the user view.
   */
  sharedPredicate(query: AccessibleWorkspaceQuery): SQL;
  findGrantNarrowing(
    query: GrantNarrowingQuery,
  ): Promise<GrantNarrowing | null>;
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

  /** Filter canonical objects using this evaluator's principal, policy, and expiry instant. */
  resourcePredicate(
    principal: UserPrincipal,
    action: AuthorizationAction,
  ): SQL {
    return this.#store.resourcePredicate({
      action,
      evaluatedAt: this.#clock(),
      userId: principal.userId,
      workspaceId: principal.workspaceId,
    });
  }

  /** Filter the workspace's objects to the ones the principal reaches as a member. */
  memberResourcePredicate(principal: UserPrincipal): SQL {
    return this.#store.memberPredicate({
      evaluatedAt: this.#clock(),
      userId: principal.userId,
      workspaceId: principal.workspaceId,
    });
  }

  /** Filter objects across workspaces to the ones shared with the principal from workspaces it does not belong to. */
  sharedResourcePredicate(principal: UserPrincipal): SQL {
    return this.#store.sharedPredicate({
      evaluatedAt: this.#clock(),
      userId: principal.userId,
    });
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

  /** The views and sections of an Event the principal sees through narrowed grants alone, or null for all of it. */
  async narrowing(
    principal: UserPrincipal,
    resource: ResourceRef,
  ): Promise<GrantNarrowing | null> {
    if (resource.workspaceId !== principal.workspaceId) return null;
    return this.#store.findGrantNarrowing({
      evaluatedAt: this.#clock(),
      resourceId: resource.id,
      userId: principal.userId,
      workspaceId: principal.workspaceId,
    });
  }
}
