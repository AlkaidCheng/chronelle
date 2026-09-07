import {
  objects,
  resourceGrants,
  roles as resourceRoles,
  workspaceMembers,
  type Database,
  type DatabaseTransaction,
  type Role,
} from "@chronelle/db";
import { and, eq, gt, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { recoveryAccessPredicate } from "./recovery-policy.js";
import { roleAllows } from "./authorization.js";

import type {
  AccessibleWorkspaceQuery,
  AuthorizationStore,
  ResourceRolesQuery,
  ResourceAccessQuery,
  WorkspaceAccessQuery,
  WorkspaceRoleQuery,
} from "./authorization.js";

const maximumBatchSize = 1000;

export class DrizzleAuthorizationStore implements AuthorizationStore {
  readonly #database: Database | DatabaseTransaction;

  constructor(database: Database | DatabaseTransaction) {
    this.#database = database;
  }

  resourcePredicate(query: ResourceAccessQuery): SQL {
    if (query.action === "recover") {
      return recoveryAccessPredicate(
        { type: "user", userId: query.userId, workspaceId: query.workspaceId },
        query.evaluatedAt,
      );
    }
    const roles = this.#resourceRoles(query);
    const allowedRoles = resourceRoles.filter((role) =>
      roleAllows(role, query.action),
    );
    return sql`(${and(
      eq(objects.workspaceId, query.workspaceId),
      isNull(objects.deletedAt),
      or(
        ...Object.values(roles).map((role) =>
          inArray(sql`(${role})`, allowedRoles),
        ),
      ),
    )})`;
  }

  async findRecoverableResourceIds(
    query: ResourceRolesQuery,
  ): Promise<ReadonlySet<string>> {
    const ids = new Set<string>();
    for (
      let start = 0;
      start < query.resourceIds.length;
      start += maximumBatchSize
    ) {
      const resources = await this.#database
        .select({ id: objects.id })
        .from(objects)
        .where(
          and(
            inArray(
              objects.id,
              query.resourceIds.slice(start, start + maximumBatchSize),
            ),
            recoveryAccessPredicate(
              {
                type: "user",
                userId: query.userId,
                workspaceId: query.workspaceId,
              },
              query.evaluatedAt,
            ),
          ),
        );
      for (const resource of resources) ids.add(resource.id);
    }
    return ids;
  }

  async findResourceRoles(
    query: ResourceRolesQuery,
  ): Promise<ReadonlyMap<string, readonly Role[]>> {
    const resourceRoles = this.#resourceRoles(query);
    const membership = resourceRoles.membership.as("membership_role");
    const direct = resourceRoles.direct.as("direct_role");
    const inherited = resourceRoles.inherited.as("inherited_role");
    const roles = new Map<string, readonly Role[]>();
    for (
      let start = 0;
      start < query.resourceIds.length;
      start += maximumBatchSize
    ) {
      const rows = await this.#database
        .select({
          id: objects.id,
          membership: membership.role,
          direct: direct.role,
          inherited: inherited.role,
        })
        .from(objects)
        .leftJoinLateral(membership, sql`true`)
        .leftJoinLateral(direct, sql`true`)
        .leftJoinLateral(inherited, sql`true`)
        .where(
          and(
            eq(objects.workspaceId, query.workspaceId),
            isNull(objects.deletedAt),
            inArray(
              objects.id,
              query.resourceIds.slice(start, start + maximumBatchSize),
            ),
          ),
        );
      for (const row of rows) {
        roles.set(
          row.id,
          [row.membership, row.direct, row.inherited].filter(
            (role): role is Role => role !== null,
          ),
        );
      }
    }
    return roles;
  }

  #resourceRoles(query: WorkspaceAccessQuery) {
    const scope = alias(objects, "permission_scope");
    const direct = alias(resourceGrants, "direct_grant");
    const inherited = alias(resourceGrants, "scope_grant");
    const activeGrant = (grant: typeof direct | typeof inherited) =>
      and(
        eq(grant.workspaceId, query.workspaceId),
        eq(grant.principalType, "user"),
        eq(grant.principalId, query.userId),
        or(isNull(grant.expiresAt), gt(grant.expiresAt, query.evaluatedAt)),
      );
    const membership = this.#database
      .select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, query.workspaceId),
          eq(workspaceMembers.userId, query.userId),
        ),
      );
    const directRole = this.#database
      .select({ role: direct.role })
      .from(direct)
      .where(and(activeGrant(direct), eq(direct.resourceId, objects.id)));
    const inheritedRole = this.#database
      .select({ role: inherited.role })
      .from(inherited)
      .innerJoin(
        scope,
        and(
          eq(scope.workspaceId, inherited.workspaceId),
          eq(scope.id, inherited.resourceId),
          isNull(scope.deletedAt),
        ),
      )
      .where(
        and(
          activeGrant(inherited),
          eq(inherited.resourceId, objects.permissionScopeId),
        ),
      );
    // Batch joins and scalar predicates reuse identical role queries.
    return {
      membership,
      direct: directRole,
      inherited: inheritedRole,
    };
  }

  async hasWorkspaceAccess(query: WorkspaceAccessQuery): Promise<boolean> {
    const membership = await this.#database
      .select({ userId: workspaceMembers.userId })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, query.workspaceId),
          eq(workspaceMembers.userId, query.userId),
        ),
      )
      .limit(1);

    if (membership.length > 0) {
      return true;
    }

    const grant = await this.#database
      .select({ id: resourceGrants.id })
      .from(resourceGrants)
      .innerJoin(
        objects,
        and(
          eq(objects.workspaceId, resourceGrants.workspaceId),
          eq(objects.id, resourceGrants.resourceId),
        ),
      )
      .where(
        and(
          eq(resourceGrants.workspaceId, query.workspaceId),
          eq(resourceGrants.principalType, "user"),
          eq(resourceGrants.principalId, query.userId),
          or(
            isNull(resourceGrants.expiresAt),
            gt(resourceGrants.expiresAt, query.evaluatedAt),
          ),
          or(isNull(objects.deletedAt), eq(resourceGrants.role, "owner")),
        ),
      )
      .limit(1);

    return grant.length > 0;
  }

  async listAccessibleWorkspaceIds(
    query: AccessibleWorkspaceQuery,
  ): Promise<readonly string[]> {
    const [memberships, grants] = await Promise.all([
      this.#database
        .select({ workspaceId: workspaceMembers.workspaceId })
        .from(workspaceMembers)
        .where(eq(workspaceMembers.userId, query.userId)),
      this.#database
        .selectDistinct({ workspaceId: resourceGrants.workspaceId })
        .from(resourceGrants)
        .innerJoin(
          objects,
          and(
            eq(objects.workspaceId, resourceGrants.workspaceId),
            eq(objects.id, resourceGrants.resourceId),
          ),
        )
        .where(
          and(
            eq(resourceGrants.principalType, "user"),
            eq(resourceGrants.principalId, query.userId),
            or(
              isNull(resourceGrants.expiresAt),
              gt(resourceGrants.expiresAt, query.evaluatedAt),
            ),
            or(isNull(objects.deletedAt), eq(resourceGrants.role, "owner")),
          ),
        ),
    ]);

    return [
      ...new Set([
        ...memberships.map(({ workspaceId }) => workspaceId),
        ...grants.map(({ workspaceId }) => workspaceId),
      ]),
    ];
  }

  async findWorkspaceRole(query: WorkspaceRoleQuery): Promise<Role | null> {
    const [membership] = await this.#database
      .select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, query.workspaceId),
          eq(workspaceMembers.userId, query.userId),
        ),
      )
      .limit(1);

    return membership?.role ?? null;
  }
}
