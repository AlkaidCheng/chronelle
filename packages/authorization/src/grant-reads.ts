import { resourceGrants, users, type Database } from "@livtales/db";
import { and, asc, eq, gt, isNull, or } from "drizzle-orm";

import type { UserPrincipal } from "./authorization.js";
import { withReadAuthorization } from "./authorization-transaction.js";
import { grantScopeOf, type ResourceGrantResource } from "./grant-service.js";

/**
 * Read boundary for the grants on one resource. Implementations evaluate the
 * principal's recovery permission on the resource, exclude expired grants at
 * the evaluation instant, and order by creation time then grant id.
 */
export interface GrantReadRepository {
  listGrants(
    principal: UserPrincipal,
    resourceId: string,
  ): Promise<readonly ResourceGrantResource[]>;
}

export class PostgresGrantReadRepository implements GrantReadRepository {
  readonly #clock: () => Date;
  readonly #database: Database;

  constructor(database: Database, clock: () => Date = () => new Date()) {
    this.#database = database;
    this.#clock = clock;
  }

  async listGrants(
    principal: UserPrincipal,
    resourceId: string,
  ): Promise<readonly ResourceGrantResource[]> {
    return withReadAuthorization(
      this.#database,
      async (transaction, authorization) => {
        const evaluatedAt = this.#clock();
        await authorization.assertCan(principal, "recover", {
          id: resourceId,
          workspaceId: principal.workspaceId,
        });
        const grants = await transaction
          .select({
            id: resourceGrants.id,
            workspaceId: resourceGrants.workspaceId,
            resourceId: resourceGrants.resourceId,
            role: resourceGrants.role,
            grantedBy: resourceGrants.grantedBy,
            createdAt: resourceGrants.createdAt,
            expiresAt: resourceGrants.expiresAt,
            scope: resourceGrants.scope,
            sectionId: resourceGrants.sectionId,
            principalId: users.id,
            principalDisplayName: users.displayName,
            principalEmail: users.email,
          })
          .from(resourceGrants)
          .innerJoin(users, eq(users.id, resourceGrants.principalId))
          .where(
            and(
              eq(resourceGrants.workspaceId, principal.workspaceId),
              eq(resourceGrants.resourceId, resourceId),
              or(
                isNull(resourceGrants.expiresAt),
                gt(resourceGrants.expiresAt, evaluatedAt),
              ),
            ),
          )
          .orderBy(asc(resourceGrants.createdAt), asc(resourceGrants.id));

        return grants.map((grant) => ({
          id: grant.id,
          workspaceId: grant.workspaceId,
          resourceId: grant.resourceId,
          role: grant.role,
          grantedBy: grant.grantedBy,
          createdAt: grant.createdAt,
          expiresAt: grant.expiresAt,
          scope: grantScopeOf(grant),
          principal: {
            id: grant.principalId,
            displayName: grant.principalDisplayName,
            email: grant.principalEmail,
          },
        }));
      },
    );
  }
}
