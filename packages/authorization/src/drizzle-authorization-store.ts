import {
  objects,
  resourceGrants,
  workspaceMembers,
  type Database,
  type Role,
} from "@chronelle/db";
import { and, eq, gt, inArray, isNull, or } from "drizzle-orm";

import type {
  AccessibleWorkspaceQuery,
  AuthorizationStore,
  ResourceRoleQuery,
  WorkspaceAccessQuery,
  WorkspaceRoleQuery,
} from "./authorization.js";

export class DrizzleAuthorizationStore implements AuthorizationStore {
  readonly #database: Database;

  constructor(database: Database) {
    this.#database = database;
  }

  async findResourceRoles(
    query: ResourceRoleQuery,
  ): Promise<readonly Role[] | null> {
    const [resource] = await this.#database
      .select({
        id: objects.id,
        permissionScopeId: objects.permissionScopeId,
      })
      .from(objects)
      .where(
        and(
          eq(objects.workspaceId, query.resource.workspaceId),
          eq(objects.id, query.resource.id),
          isNull(objects.deletedAt),
        ),
      )
      .limit(1);

    if (resource === undefined) {
      return null;
    }

    const scopeIds =
      resource.permissionScopeId === resource.id
        ? [resource.id]
        : [resource.id, resource.permissionScopeId];
    const [memberships, grants] = await Promise.all([
      this.#database
        .select({ role: workspaceMembers.role })
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, query.resource.workspaceId),
            eq(workspaceMembers.userId, query.userId),
          ),
        )
        .limit(1),
      this.#database
        .select({ role: resourceGrants.role })
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
            eq(resourceGrants.workspaceId, query.resource.workspaceId),
            eq(resourceGrants.principalType, "user"),
            eq(resourceGrants.principalId, query.userId),
            inArray(resourceGrants.resourceId, scopeIds),
            or(
              isNull(resourceGrants.expiresAt),
              gt(resourceGrants.expiresAt, query.evaluatedAt),
            ),
            isNull(objects.deletedAt),
          ),
        ),
    ]);

    return [
      ...memberships.map(({ role }) => role),
      ...grants.map(({ role }) => role),
    ];
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
          isNull(objects.deletedAt),
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
            isNull(objects.deletedAt),
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
